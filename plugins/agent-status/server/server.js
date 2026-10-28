#!/usr/bin/env node
// Agent Status service: receives hook events from Claude Code sessions, keeps the status of
// each session and serves the web dashboard, the JSON/SSE API, key images and the SwiftBar
// menu. Listens on 127.0.0.1.
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { focus, logAttempt, appName, doctor } = require('./focus');
const { createKeepAwake } = require('./keepawake');
const settings = require('./config');
const { APPROVAL_TYPES, approvalFor, approvalsList, notificationText, notify } = require('./approvals');

const PORT = Number(process.env.AGENT_STATUS_PORT) || 4317;
const HOST = '127.0.0.1';
const STATE_DIR = process.env.AGENT_STATUS_DIR || path.join(os.homedir(), '.claude', 'agent-status');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const STALL_MS = (Number(process.env.AGENT_STATUS_STALL_MIN) || 3) * 60e3;   // in_progress -> sleeping
const FORGET_MS = 6 * 3600e3;                                                  // sessions without a PID are dropped after this
const RETRY_AFTER = 2;                                                         // consecutive tool failures
const DEMO = process.argv.includes('--demo');
const TICK_MS = (Number(process.env.AGENT_STATUS_TICK_S) || 5) * 1e3;               // periodic update interval
const AWAKE_GRACE_MS = (Number(process.env.AGENT_STATUS_AWAKE_GRACE_S) || 60) * 1e3; // keep-awake hold after work stops

const config = DEMO ? { ...settings.DEFAULTS } : settings.load(STATE_DIR);
const keepAwake = createKeepAwake({ graceMs: AWAKE_GRACE_MS, powerTtlMs: Math.min(15e3, TICK_MS * 3), dryRun: DEMO });

const STATUSES = ['waiting', 'retry', 'in_progress', 'sleeping', 'done'];
const LABEL = {
  waiting: 'needs input', retry: 'retry', in_progress: 'in progress',
  sleeping: 'sleeping', done: 'done',
};
const COLOR = {
  waiting: '#F5A524', retry: '#F04D4D', in_progress: '#4C8DFF',
  sleeping: '#8B8FA3', done: '#2FBF71',
};

// Whether the session's Claude Code process is running: true, false, or null (no PID recorded).
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
    // Restores sessions whose Claude Code process is still running.
    for (const a of arr) if (a && a.id && alive(a) === true) agents.set(a.id, a);
  } catch { /* no saved state */ }
}
function saveNow() {
  if (DEMO) return;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify([...agents.values()]));
    fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
  } catch { /* ignore */ }
}
// SIGTERM: save state, release keep-awake and exit. SIGHUP: ignored.
process.on('SIGTERM', () => { saveNow(); keepAwake.stop(); process.exit(0); });
if (!DEMO) process.on('SIGHUP', () => {});

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
  if (status !== 'waiting') delete a.approval;
}

// Marks an agent as waiting for approval (detail: what is being approved); shows a system
// notification when the wait starts.
function startApproval(a, message, now) {
  const continuing = a.status === 'waiting' && a.approval;
  const approval = continuing ? a.approval : approvalFor(a, message, now);
  setStatus(a, 'waiting', approval.detail, now);
  a.approval = approval;
  if (!continuing && !DEMO && config.systemNotifications) notify(notificationText(a));
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
      a.lastToolDetail = ev.detail || ev.tool;
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
      if (APPROVAL_TYPES.has(ev.notification_type)) {
        startApproval(a, ev.message, now);
      } else if (ev.notification_type === 'idle_prompt') {
        if (a.status !== 'done') setStatus(a, 'sleeping', ev.message || 'Idle, waiting for input', now);
      } else if (!ev.notification_type && /permission|approve|input/i.test(ev.message || '')) {
        startApproval(a, ev.message, now);
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

// Periodic update: idle in-progress sessions become sleeping; ended or stale sessions are removed.
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
  const before = JSON.stringify(keepAwake.state());
  updateKeepAwake();
  if (changed || JSON.stringify(keepAwake.state()) !== before) broadcast();
}

function updateKeepAwake() {
  return keepAwake.update([...agents.values()], config.keepAwake);
}

// ---------- views ----------
function snapshot() {
  const list = [...agents.values()].map((a) => ({
    id: a.id, slot: a.slot, project: a.project, cwd: a.cwd, branch: a.branch,
    status: a.status, label: LABEL[a.status], color: COLOR[a.status],
    detail: a.detail, prompt: a.prompt, since: a.since, startedAt: a.startedAt,
    lastActivity: a.lastActivity, subagents: a.subagents, tool: a.pendingTool,
    terminal: describeTerminal(a.loc),
    approval: a.status === 'waiting' ? a.approval : undefined,
  }));
  list.sort((x, y) => STATUSES.indexOf(x.status) - STATUSES.indexOf(y.status) || x.slot - y.slot);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const a of list) counts[a.status]++;
  return {
    agents: list, counts, labels: LABEL, colors: COLOR, ts: Date.now(),
    approvals: approvalsList([...agents.values()]),
    keepAwake: keepAwake.state(),
    config,
  };
}

function describeTerminal(loc) {
  if (!loc) return null;
  return [appName(loc), loc.tmuxPane ? 'tmux' : null].filter(Boolean).join(' · ') || null;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 144x144 SVG key image for a slot.
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
<text x="72" y="130" font-family="Helvetica,Arial" font-size="14" font-weight="${a.status === 'waiting' ? 700 : 400}" fill="${COLOR[a.status]}" text-anchor="middle">${a.status === 'waiting' ? 'APPROVE?' : esc(LABEL[a.status])} ${t}</text>
</svg>`;
}

function ago(ms) {
  const m = Math.floor(Math.max(0, ms) / 60e3);
  return m < 1 ? '<1m' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`;
}

// SwiftBar parameter value: no "|" (field separator) and no double quotes.
function sbText(t) {
  return String(t ?? '').replace(/\|/g, '/').replace(/"/g, "'");
}

// Menu in SwiftBar / xbar format. Status display only; the sole actions are focusing a
// session (focus-cli.js) and opening the dashboard.
//   title: ⚠ approvals (orange), ↻ retry, ● in progress, ✓ done, ☕ while keeping the Mac awake
//   rows:  sessions that need approval, then all other agents, then the keep-awake state
function swiftbar() {
  const s = snapshot();
  const c = s.counts;
  const now = Date.now();
  const ka = s.keepAwake;
  const head = [
    c.waiting ? `⚠${c.waiting}` : '', c.retry ? `↻${c.retry}` : '',
    c.in_progress ? `●${c.in_progress}` : '', c.done ? `✓${c.done}` : '',
    ka.active ? '☕' : '',
  ].filter(Boolean).join(' ') || '◌';
  const lines = [`${head} | font=Menlo size=12${c.waiting ? ' color=#F5A524' : ''}`, '---'];
  const DOT = { waiting: '🟠', retry: '🔴', in_progress: '🔵', sleeping: '⚪️', done: '🟢' };
  const click = (a) => `bash="${process.execPath}" param1="${FOCUS_CLI}" param2=${a.id} param3=menubar terminal=false refresh=true`;

  if (s.approvals.length) {
    lines.push(`Needs your approval (${s.approvals.length}) | size=11 color=#F5A524`);
    for (const ap of s.approvals) {
      const a = s.agents.find((x) => x.id === ap.id);
      lines.push(`🟠 ${ap.slot}. ${sbText(ap.project)} · ${sbText(ap.detail).slice(0, 60)} · ${ago(now - ap.since)} | ${click(a)} tooltip="${sbText(ap.detail).slice(0, 160)}"`);
    }
    lines.push('---');
  }
  const others = s.agents.filter((a) => a.status !== 'waiting');
  for (const a of others) {
    const txt = sbText(`${DOT[a.status] || '•'} ${a.slot}. ${a.project} — ${a.label}`);
    const tip = sbText([a.detail, a.terminal].filter(Boolean).join(' · ')).slice(0, 160);
    lines.push(`${txt} | ${click(a)}${tip ? ` tooltip="${tip}"` : ''}`);
  }
  if (!s.agents.length) lines.push('No agents');

  lines.push('---');
  lines.push(`${ka.active ? `☕ Keeping Mac awake: ${sbText(ka.reason)}` : `Sleep allowed: ${sbText(ka.reason)}`} | size=12 color=#8B8FA3`);
  lines.push(`Open dashboard | href=http://${HOST}:${PORT}/`);
  return lines.join('\n');
}

// ---------- SSE ----------
const clients = new Set();
let bTimer = null;
function broadcast() {
  save();
  updateKeepAwake();
  clearTimeout(bTimer);
  bTimer = setTimeout(() => {
    const msg = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of clients) res.write(msg);
  }, 50);
}

// ---------- HTTP ----------
const PUBLIC = path.join(__dirname, 'public');
const FOCUS_CLI = path.join(__dirname, 'focus-cli.js');

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
  // Accepts only localhost Host headers.
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return send(res, 403, { error: 'forbidden host' });

  const url = new URL(req.url, `http://${HOST}`);
  const p = url.pathname;

  if (req.method === 'POST') {
    // POST bodies must be JSON (application/json).
    if (!/application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'json only' });
    let body = {};
    try { const t = await readBody(req); body = t ? JSON.parse(t) : {}; } catch { return send(res, 400, { error: 'bad json' }); }

    if (p === '/event') { if (apply(body)) broadcast(); return send(res, 204, ''); }

    let m = p.match(/^\/api\/agents\/([\w-]+)\/(focus|dismiss)$/);
    if (m) {
      const a = agents.get(m[1]);
      if (!a) return send(res, 404, { error: 'unknown agent' });
      if (m[2] === 'dismiss') { agents.delete(a.id); broadcast(); return send(res, 200, { ok: true }); }
      const r = await focus(a); logAttempt(a, r, 'dashboard');
      return send(res, 200, r);
    }
    m = p.match(/^\/api\/slot\/(\d+)\/focus$/);
    if (m) {
      const a = [...agents.values()].find((x) => x.slot === Number(m[1]));
      if (!a) return send(res, 404, { error: 'empty slot' });
      const r = await focus(a); logAttempt(a, r, 'api');
      return send(res, 200, r);
    }
    if (p === '/api/config') {
      const r = settings.validate(body);
      if (r.error) return send(res, 400, { error: r.error });
      Object.assign(config, r.value);
      if (!DEMO) { try { settings.save(STATE_DIR, config); } catch { /* not writable */ } }
      broadcast();
      return send(res, 200, config);
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
  if (p === '/health') return send(res, 200, { ok: true, agents: agents.size, demo: DEMO, pid: process.pid });
  if (p === '/api/agents') return send(res, 200, snapshot());
  if (p === '/api/config') return send(res, 200, config);
  if (p === '/api/doctor') return send(res, 200, { ...(await doctor()), pid: process.pid, ppid: process.ppid });
  if (p === '/api/swiftbar') return send(res, 200, swiftbar(), 'text/plain; charset=utf-8');
  if (p === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`retry: 2000\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  let m = p.match(/^\/api\/agents\/([\w-]+)$/);
  if (m) { const a = agents.get(m[1]); return a ? send(res, 200, a) : send(res, 404, { error: 'unknown agent' }); }
  m = p.match(/^\/api\/slot\/(\d+)\/raw$/);
  if (m) { const a = [...agents.values()].find((x) => x.slot === Number(m[1])); return a ? send(res, 200, a) : send(res, 404, { error: 'empty slot' }); }
  m = p.match(/^\/api\/slot\/(\d+)(\.svg)?$/);
  if (m) {
    const slot = Number(m[1]);
    const a = [...agents.values()].find((x) => x.slot === slot);
    if (m[2]) return send(res, 200, keySvg(a && snapshot().agents.find((x) => x.id === a.id), slot), 'image/svg+xml');
    return send(res, 200, a ? snapshot().agents.find((x) => x.id === a.id) : { slot, empty: true });
  }
  return send(res, 404, { error: 'not found' });
});

setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20e3).unref();
setInterval(tick, TICK_MS).unref();

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') process.exit(0); // port already served by a running instance
  console.error(e); process.exit(1);
});

load();
server.listen(PORT, HOST, () => {
  console.log(`agent-status on http://${HOST}:${PORT}/${DEMO ? '  (demo mode)' : ''}`);
  updateKeepAwake();
  if (DEMO) require('./demo').start(apply, broadcast);
});
