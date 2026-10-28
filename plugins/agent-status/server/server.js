#!/usr/bin/env node
// agent-status daemon: collects hook events from every Claude Code session and
// serves the board (web dashboard, JSON/SSE API, Stream Deck key images,
// SwiftBar menu). Binds to 127.0.0.1 only. Zero dependencies.
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { focus } = require('./focus');

const PORT = Number(process.env.AGENT_STATUS_PORT) || 4317;
const HOST = '127.0.0.1';
const STATE_DIR = process.env.AGENT_STATUS_DIR || path.join(os.homedir(), '.claude', 'agent-status');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const STALL_MS = (Number(process.env.AGENT_STATUS_STALL_MIN) || 3) * 60e3;   // in_progress -> sleeping
const FORGET_MS = 6 * 3600e3;                                                  // fallback when no PID is known
const RETRY_AFTER = 2;                                                         // consecutive tool failures
const DEMO = process.argv.includes('--demo');

const STATUSES = ['waiting', 'retry', 'in_progress', 'sleeping', 'done'];
const LABEL = {
  waiting: 'needs input', retry: 'retry', in_progress: 'in progress',
  sleeping: 'sleeping', done: 'done',
};
const COLOR = {
  waiting: '#F5A524', retry: '#F04D4D', in_progress: '#4C8DFF',
  sleeping: '#8B8FA3', done: '#2FBF71',
};

// Is the Claude Code process behind this session still running?
// true = alive, false = gone, null = unknown (no PID recorded).
function alive(a) {
  const pid = a.loc && Number(a.loc.pid);
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** @type {Map<string, any>} */
const agents = new Map();

// ---------- persistence ----------
function load() {
  if (DEMO) return;
  try {
    const arr = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Only bring back sessions whose Claude process is still running.
    for (const a of arr) if (a && a.id && alive(a) === true) agents.set(a.id, a);
  } catch { /* first run */ }
}
let saveTimer = null;
function save() {
  if (DEMO) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify([...agents.values()]));
      fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
    } catch { /* ignore */ }
  }, 300);
}

// ---------- helpers ----------
function gitBranch(cwd) {
  try {
    let dir = cwd;
    for (let i = 0; i < 12 && dir; i++) {
      const g = path.join(dir, '.git');
      if (fs.existsSync(g)) {
        let gitDir = g;
        if (fs.statSync(g).isFile()) { // worktree: "gitdir: ..."
          const m = fs.readFileSync(g, 'utf8').match(/gitdir:\s*(.+)/);
          if (m) gitDir = path.resolve(dir, m[1].trim());
        }
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        const m = head.match(/^ref: refs\/heads\/(.+)$/);
        return m ? m[1] : head.slice(0, 7);
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch { /* ignore */ }
  return undefined;
}

function nextSlot() {
  const used = new Set([...agents.values()].map((a) => a.slot));
  let s = 1;
  while (used.has(s)) s++;
  return s;
}

function setStatus(a, status, detail, now) {
  if (a.status !== status) { a.status = status; a.since = now; }
  if (detail !== undefined) a.detail = detail;
}

// ---------- event -> state ----------
function apply(ev) {
  const id = String(ev.session_id || '');
  if (!/^[\w-]{1,80}$/.test(id)) return false;
  const now = Number(ev.ts) || Date.now();
  let a = agents.get(id);
  if (!a) {
    a = {
      id, slot: nextSlot(), cwd: ev.cwd, project: ev.cwd ? path.basename(ev.cwd) : id.slice(0, 8),
      branch: ev.cwd ? gitBranch(ev.cwd) : undefined, status: 'sleeping', since: now,
      startedAt: now, lastActivity: now, detail: 'New session', failures: 0, subagents: 0,
      pendingTool: null, prompt: null, loc: null,
    };
    agents.set(id, a);
  }
  if (ev.cwd && ev.cwd !== a.cwd) { a.cwd = ev.cwd; a.project = path.basename(ev.cwd); }
  if (ev.loc) a.loc = { ...(a.loc || {}), ...ev.loc };
  a.lastActivity = now;
  a.lastEvent = ev.event;

  switch (ev.event) {
    case 'SessionStart':
      a.branch = a.cwd ? gitBranch(a.cwd) : a.branch;
      if (ev.source === 'startup') setStatus(a, 'sleeping', ev.source === 'resume' ? 'Resumed' : 'Waiting for first prompt', now);
      break;
    case 'UserPromptSubmit':
      a.failures = 0; a.prompt = ev.prompt || a.prompt; a.branch = a.cwd ? gitBranch(a.cwd) : a.branch;
      setStatus(a, 'in_progress', ev.prompt || 'Working…', now);
      break;
    case 'PreToolUse':
      a.pendingTool = ev.tool || 'tool';
      if (a.status !== 'retry') setStatus(a, 'in_progress', ev.detail || ev.tool, now);
      else a.detail = ev.detail || a.detail;
      break;
    case 'PostToolUse':
      a.pendingTool = null; a.failures = 0;
      if (a.status !== 'in_progress') setStatus(a, 'in_progress', a.detail, now);
      break;
    case 'PostToolUseFailure':
      a.pendingTool = null;
      if (ev.is_interrupt) break;
      a.failures += 1;
      if (a.failures >= RETRY_AFTER) setStatus(a, 'retry', `${ev.tool || 'Tool'} failed ×${a.failures}: ${ev.error || ''}`.trim(), now);
      break;
    case 'StopFailure':
      a.pendingTool = null;
      setStatus(a, 'retry', `API error: ${ev.error || 'request failed'}`, now);
      break;
    case 'Notification':
      if (ev.notification_type === 'permission_prompt' || ev.notification_type === 'elicitation_dialog') {
        setStatus(a, 'waiting', ev.message || 'Needs your input', now);
      } else if (ev.notification_type === 'idle_prompt') {
        if (a.status !== 'done') setStatus(a, 'sleeping', ev.message || 'Idle, waiting for input', now);
      } else if (!ev.notification_type && /permission|approve|input/i.test(ev.message || '')) {
        setStatus(a, 'waiting', ev.message, now);
      }
      break;
    case 'Stop':
      a.pendingTool = null; a.failures = 0; a.subagents = 0;
      setStatus(a, 'done', a.prompt ? `Done: ${a.prompt}` : 'Done', now);
      break;
    case 'SubagentStart': a.subagents += 1; break;
    case 'SubagentStop': a.subagents = Math.max(0, a.subagents - 1); break;
    case 'SessionEnd':
      agents.delete(id);
      break;
    default: return false;
  }
  return true;
}

// Time-based transitions: stalled work -> sleeping, cleanup.
function tick() {
  const now = Date.now();
  let changed = false;
  for (const a of agents.values()) {
    if (a.status === 'in_progress' && !a.pendingTool && a.subagents === 0 && now - a.lastActivity > STALL_MS) {
      setStatus(a, 'sleeping', `No activity for ${Math.round((now - a.lastActivity) / 60e3)} min`, now); changed = true;
    }
    const live = alive(a);
    if (live === false || (live === null && now - a.lastActivity > FORGET_MS)) {
      agents.delete(a.id); changed = true;
    }
  }
  if (changed) broadcast();
}

// ---------- views ----------
function snapshot() {
  const list = [...agents.values()].map((a) => ({
    id: a.id, slot: a.slot, project: a.project, cwd: a.cwd, branch: a.branch,
    status: a.status, label: LABEL[a.status], color: COLOR[a.status],
    detail: a.detail, prompt: a.prompt, since: a.since, startedAt: a.startedAt,
    lastActivity: a.lastActivity, subagents: a.subagents, tool: a.pendingTool,
    terminal: describeTerminal(a.loc),
  }));
  list.sort((x, y) => STATUSES.indexOf(x.status) - STATUSES.indexOf(y.status) || x.slot - y.slot);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const a of list) counts[a.status]++;
  return { agents: list, counts, labels: LABEL, colors: COLOR, ts: Date.now() };
}

function describeTerminal(loc) {
  if (!loc) return null;
  if (loc.terminalEmulator && /JetBrains/i.test(loc.terminalEmulator)) return ['JetBrains IDE', loc.tmuxPane ? 'tmux' : null].filter(Boolean).join(' · ');
  if (loc.termProgram === 'vscode') return 'VS Code';
  const app = {
    'com.googlecode.iterm2': 'iTerm2', 'com.apple.Terminal': 'Terminal', 'com.mitchellh.ghostty': 'Ghostty',
    'com.github.wez.wezterm': 'WezTerm', 'dev.warp.Warp-Stable': 'Warp', 'net.kovidgoyal.kitty': 'kitty',
    'com.microsoft.VSCode': 'VS Code', 'com.todesktop.230313mzl4w4u92': 'Cursor', 'com.exafunction.windsurf': 'Windsurf',
  }[loc.bundleId] || loc.lcTerminal || loc.termProgram || null;
  return [app, loc.tmuxPane ? 'tmux' : null].filter(Boolean).join(' · ') || null;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 144x144 key image for Stream Deck (or anything that wants a tile).
function keySvg(a, slot) {
  if (!a) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="#111216"/><text x="72" y="80" font-family="Helvetica,Arial" font-size="18" fill="#3a3c45" text-anchor="middle">${slot}</text></svg>`;
  }
  const name = a.project.length > 11 ? a.project.slice(0, 10) + '…' : a.project;
  const mins = Math.floor((Date.now() - a.since) / 60e3);
  const t = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60}m`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
<rect width="144" height="144" fill="#111216"/>
<rect x="0" y="0" width="144" height="10" fill="${COLOR[a.status]}"/>
<circle cx="72" cy="58" r="26" fill="${COLOR[a.status]}" opacity="1"/>
<text x="72" y="66" font-family="Helvetica,Arial" font-weight="700" font-size="22" fill="#111216" text-anchor="middle">${a.slot}</text>
<text x="72" y="108" font-family="Helvetica,Arial" font-weight="700" font-size="17" fill="#F2F3F5" text-anchor="middle">${esc(name)}</text>
<text x="72" y="130" font-family="Helvetica,Arial" font-size="14" fill="${COLOR[a.status]}" text-anchor="middle">${esc(LABEL[a.status])} ${t}</text>
</svg>`;
}

// SwiftBar / xbar menu-bar format.
function swiftbar() {
  const s = snapshot();
  const c = s.counts;
  const head = [
    c.waiting ? `⚠${c.waiting}` : '', c.retry ? `↻${c.retry}` : '',
    c.in_progress ? `●${c.in_progress}` : '', c.done ? `✓${c.done}` : '',
  ].filter(Boolean).join(' ') || '◌';
  const lines = [`${head} | font=Menlo size=12`, '---'];
  const DOT = { waiting: '🟠', retry: '🔴', in_progress: '🔵', sleeping: '⚪️', done: '🟢' };
  for (const a of s.agents) {
    const url = `http://${HOST}:${PORT}/api/agents/${a.id}/focus`;
    const click = `bash=/usr/bin/curl param1=-s param2=-X param3=POST param4=-H param5=Content-Type:application/json param6=${url} terminal=false refresh=true`;
    const txt = `${DOT[a.status] || '•'} ${a.slot}. ${a.project} — ${a.label}`.replace(/\|/g, '/');
    lines.push(`${txt} | ${click}`);
    if (a.detail) lines.push(`      ${a.detail.replace(/\|/g, '/').slice(0, 70)} | size=11 color=#8B8FA3 ${click}`);
  }
  if (!s.agents.length) lines.push('No agents');
  lines.push('---', `Open dashboard | href=http://${HOST}:${PORT}/`);
  return lines.join('\n');
}

// ---------- SSE ----------
const clients = new Set();
let bTimer = null;
function broadcast() {
  save();
  clearTimeout(bTimer);
  bTimer = setTimeout(() => {
    const msg = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of clients) res.write(msg);
  }, 50);
}

// ---------- HTTP ----------
const PUBLIC = path.join(__dirname, 'public');

function send(res, code, body, type = 'application/json; charset=utf-8') {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
  res.end(buf);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // DNS-rebinding guard: only answer to localhost names.
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return send(res, 403, { error: 'forbidden host' });

  const url = new URL(req.url, `http://${HOST}`);
  const p = url.pathname;

  if (req.method === 'POST') {
    // JSON content type forces a CORS preflight from browsers, which we never approve.
    if (!/application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'json only' });
    let body = {};
    try { const t = await readBody(req); body = t ? JSON.parse(t) : {}; } catch { return send(res, 400, { error: 'bad json' }); }

    if (p === '/event') { if (apply(body)) broadcast(); return send(res, 204, ''); }

    let m = p.match(/^\/api\/agents\/([\w-]+)\/(focus|dismiss)$/);
    if (m) {
      const a = agents.get(m[1]);
      if (!a) return send(res, 404, { error: 'unknown agent' });
      if (m[2] === 'dismiss') { agents.delete(a.id); broadcast(); return send(res, 200, { ok: true }); }
      return send(res, 200, await focus(a));
    }
    m = p.match(/^\/api\/slot\/(\d+)\/focus$/);
    if (m) {
      const a = [...agents.values()].find((x) => x.slot === Number(m[1]));
      return a ? send(res, 200, await focus(a)) : send(res, 404, { error: 'empty slot' });
    }
    if (p === '/api/clear') {
      const which = new Set(body.statuses || ['done']);
      for (const a of [...agents.values()]) if (which.has(a.status)) agents.delete(a.id);
      broadcast(); return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'not found' });
  }

  if (req.method !== 'GET') return send(res, 405, { error: 'method' });

  if (p === '/' || p === '/index.html') return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), 'text/html; charset=utf-8');
  if (p === '/health') return send(res, 200, { ok: true, agents: agents.size, demo: DEMO });
  if (p === '/api/agents') return send(res, 200, snapshot());
  if (p === '/api/swiftbar') return send(res, 200, swiftbar(), 'text/plain; charset=utf-8');
  if (p === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`retry: 2000\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  let m = p.match(/^\/api\/slot\/(\d+)(\.svg)?$/);
  if (m) {
    const slot = Number(m[1]);
    const a = [...agents.values()].find((x) => x.slot === slot);
    if (m[2]) return send(res, 200, keySvg(a && snapshot().agents.find((x) => x.id === a.id), slot), 'image/svg+xml');
    return send(res, 200, a ? snapshot().agents.find((x) => x.id === a.id) : { slot, empty: true });
  }
  return send(res, 404, { error: 'not found' });
});

setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20e3).unref();
setInterval(tick, 5e3).unref();

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') process.exit(0); // another daemon already serves
  console.error(e); process.exit(1);
});

load();
server.listen(PORT, HOST, () => {
  console.log(`agent-status on http://${HOST}:${PORT}/${DEMO ? '  (demo mode)' : ''}`);
  if (DEMO) require('./demo').start(apply, broadcast);
});
