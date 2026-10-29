#!/usr/bin/env node
// Agent Status service: receives hook events from Claude Code sessions, keeps the status of
// each session and serves the web dashboard, the JSON/SSE API, key images and the SwiftBar
// menu. Listens on 127.0.0.1.
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { focus, logAttempt, appName, doctor } = require('./focus');
const { createKeepAwake } = require('./keepawake');
const settings = require('./config');
const { APPROVAL_TYPES, approvalFor, approvalsList, notificationText } = require('./approvals');
const { taskEndNotice, reminderNotice, notify } = require('./notifications');
const { createCompat } = require('./compat');
const transcript = require('./transcript');

const PORT = Number(process.env.AGENT_STATUS_PORT) || 4317;
const HOST = '127.0.0.1';
const STATE_DIR = process.env.AGENT_STATUS_DIR || path.join(os.homedir(), '.claude', 'agent-status');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const STALL_MS = (Number(process.env.AGENT_STATUS_STALL_MIN) || 3) * 60e3;   // in_progress -> sleeping
const QUIET_MS = 10e3;                                                         // working with no event this long: check the transcript
const FORGET_MS = 6 * 3600e3;                                                  // sessions without a PID are dropped after this
const RETRY_AFTER = 2;                                                         // consecutive tool failures
const DEMO = process.argv.includes('--demo');
const TAKEOVER = process.argv.includes('--takeover'); // started by a running instance that is handing over
const TICK_MS = (Number(process.env.AGENT_STATUS_TICK_S) || 5) * 1e3;               // periodic update interval
const AWAKE_GRACE_MS = (Number(process.env.AGENT_STATUS_AWAKE_GRACE_S) || 60) * 1e3; // keep-awake hold after work stops

const VERSION = (() => { try { return require('../.claude-plugin/plugin.json').version; } catch { return null; } })();
const config = DEMO ? { ...settings.DEFAULTS } : settings.load(STATE_DIR);
const compat = createCompat(STATE_DIR, { persist: !DEMO, version: VERSION });
const keepAwake = createKeepAwake({ graceMs: AWAKE_GRACE_MS, powerTtlMs: Math.min(15e3, TICK_MS * 3), dryRun: DEMO });

const STATUSES = ['waiting', 'retry', 'in_progress', 'sleeping', 'done'];
// StopFailure error types, as shown when the payload has no message.
const API_ERRORS = {
  rate_limit: 'Rate limited', overloaded: 'API overloaded', authentication_failed: 'Authentication failed',
  billing_error: 'Billing error', invalid_request: 'Invalid API request', model_not_found: 'Model not found',
  server_error: 'API server error', max_output_tokens: 'Output token limit reached',
};
const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'StopFailure', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd']);
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
    for (const a of arr) {
      if (!a || !a.id || alive(a) !== true) continue;
      if (a.cwd) a.project = projectName(a.cwd);
      agents.set(a.id, a);
    }
  } catch { /* no saved state */ }
}
function saveNow() {
  if (DEMO) return;
  compat.save();
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
    compat.save();
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

// Name shown for a session: its folder, or "Claude app" for the temporary folders the Claude
// desktop app creates for its sessions.
function projectName(cwd) {
  if (/\/Application Support\/Claude\/scratch-workspaces\//.test(cwd)) return 'Claude app';
  return path.basename(cwd);
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
function startApproval(a, message, now, type) {
  const continuing = a.status === 'waiting' && a.approval;
  const approval = continuing ? a.approval : approvalFor(a, message, now, type);
  if (!continuing && type === 'permission_prompt') {
    if (a.lastToolUseId) approval.toolUseId = a.lastToolUseId;
    // For a Bash command, the shells the session runs now; a new one means it was approved.
    if (a.pendingTool === 'Bash') approval.shells = [...commandShells(a)];
  }
  setStatus(a, 'waiting', approval.detail, now);
  a.approval = approval;
  if (!continuing && !DEMO && config.systemNotifications) notify(notificationText(named(a)), { sound: config.notificationSound });
}

// Ends the current task (Stop or StopFailure) and notifies when it was a long one.
function endTask(a, outcome, now) {
  const notice = DEMO ? null : taskEndNotice(named(a), outcome, now, config);
  if (notice) notify(notice, { sound: config.notificationSound });
  delete a.taskStartedAt;
}

// ---------- event -> state ----------
function apply(ev) {
  if (!ev || typeof ev !== 'object') return false;
  if (ev.event === '_malformed') { compat.malformed(ev.keys); save(); return false; }
  const id = String(ev.session_id || '');
  if (!/^[\w-]{1,80}$/.test(id)) return false;
  const now = Number(ev.ts) || Date.now();
  if (!EVENTS.has(ev.event)) { compat.unknown(ev.event, now); save(); return false; }
  compat.seen(ev.event, ev.missing, now);
  let a = agents.get(id);
  if (!a) {
    a = {
      id, slot: nextSlot(), cwd: ev.cwd, project: ev.cwd ? projectName(ev.cwd) : id.slice(0, 8),
      branch: ev.cwd ? gitBranch(ev.cwd) : undefined, status: 'sleeping', since: now,
      startedAt: now, lastActivity: now, detail: 'New session', failures: 0, subagents: 0,
      pendingTool: null, prompt: null, loc: null,
    };
    agents.set(id, a);
  }
  if (ev.cwd && ev.cwd !== a.cwd) { a.cwd = ev.cwd; a.project = projectName(ev.cwd); }
  if (ev.loc) a.loc = { ...(a.loc || {}), ...ev.loc };
  if (transcript.isTranscriptPath(ev.transcript)) a.transcript = ev.transcript;
  a.lastActivity = now;
  a.lastEvent = ev.event;

  switch (ev.event) {
    case 'SessionStart':
      a.branch = a.cwd ? gitBranch(a.cwd) : a.branch;
      if (ev.source === 'startup') setStatus(a, 'sleeping', ev.source === 'resume' ? 'Resumed' : 'Waiting for first prompt', now);
      break;
    case 'UserPromptSubmit':
      // Every prompt starts a new task (an interrupted task sends no Stop).
      a.taskStartedAt = now;
      a.failures = 0; a.prompt = ev.prompt || a.prompt; a.branch = a.cwd ? gitBranch(a.cwd) : a.branch;
      setStatus(a, 'in_progress', ev.prompt || 'Working…', now);
      break;
    case 'PreToolUse':
      a.pendingTool = ev.tool || 'tool';
      a.lastToolUseId = ev.tool_use_id || null;
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
      setStatus(a, 'retry', ev.message || API_ERRORS[ev.error] || 'API error', now);
      endTask(a, 'error', now);
      break;
    case 'Notification':
      compat.notificationType(ev.notification_type, now);
      if (APPROVAL_TYPES.has(ev.notification_type)) {
        startApproval(a, ev.message, now, ev.notification_type);
      } else if (ev.notification_type === 'idle_prompt') {
        if (a.status !== 'done') setStatus(a, 'sleeping', ev.message || 'Idle, waiting for input', now);
      } else if (!ev.notification_type && /permission|approve|input/i.test(ev.message || '')) {
        startApproval(a, ev.message, now);
      }
      break;
    case 'Stop':
      a.pendingTool = null; a.failures = 0; a.subagents = 0;
      setStatus(a, 'done', a.prompt ? `Done: ${a.prompt}` : 'Done', now);
      endTask(a, 'done', now);
      break;
    case 'SubagentStart': a.subagents += 1; break;
    case 'SubagentStop': a.subagents = Math.max(0, a.subagents - 1); break;
    case 'SessionEnd':
      agents.delete(id);
      break;
  }
  return true;
}

// Periodic update: idle in-progress sessions become sleeping; ended or stale sessions are
// removed; approvals pending for a while are notified once more; a code update on disk
// restarts the service.
function tick() {
  const now = Date.now();
  let changed = false;
  for (const a of agents.values()) {
    if (resolveFromTranscript(a, now)) changed = true;
    if (resolveApprovedCommand(a, now)) changed = true;
    const reminder = DEMO ? null : reminderNotice(named(a), now, config);
    if (reminder) { notify(reminder, { sound: config.notificationSound }); a.approval.reminded = true; changed = true; }
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
  checkCodeUpdate();
}

// Claude Code sends no hook event when the user interrupts a request with Esc, including a
// permission prompt dismissed that way. For a session waiting for approval, or working with no
// event for a while, the transcript tells: an interrupt makes it idle (task ended, no
// notification); an answer to a permission prompt makes it work again.
function resolveFromTranscript(a, now) {
  if (!a.transcript) return false;
  const waiting = a.status === 'waiting';
  const quiet = (a.status === 'in_progress' || a.status === 'retry') && now - a.lastActivity >= QUIET_MS;
  if (!waiting && !quiet) return false;
  const since = waiting ? (a.approval ? a.approval.since : a.since) : a.lastActivity;
  const r = transcript.after(a.transcript, since, waiting && a.approval ? a.approval.toolUseId : null);
  if (r.interrupted) {
    a.pendingTool = null; a.subagents = 0; delete a.taskStartedAt;
    setStatus(a, 'sleeping', 'Interrupted', now);
    return true;
  }
  if (waiting && r.answered) { setStatus(a, 'in_progress', a.detail, now); return true; }
  return false;
}

// Process ids of the shells Claude Code runs Bash commands in (`bash -c source
// .../shell-snapshots/snapshot-...`), among the direct children of the session's process.
function commandShells(a) {
  const pid = a.loc && Number(a.loc.pid);
  const out = new Set();
  if (!Number.isInteger(pid) || pid <= 1) return out;
  try {
    const table = execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,args='], { encoding: 'utf8', timeout: 1500, maxBuffer: 16 << 20 });
    for (const line of table.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (m && Number(m[2]) === pid && m[3].includes('shell-snapshots/snapshot-')) out.add(Number(m[1]));
    }
  } catch { /* ps not available */ }
  return out;
}

// Claude Code sends no hook event when a permission prompt is approved; the next event comes
// when the command finishes. A new command shell under the session after a Bash permission
// prompt means it was approved and is running: the session is working again.
function resolveApprovedCommand(a, now) {
  if (a.status !== 'waiting' || !a.approval || !Array.isArray(a.approval.shells)) return false;
  const before = new Set(a.approval.shells);
  for (const pid of commandShells(a)) {
    if (!before.has(pid)) { setStatus(a, 'in_progress', a.approval.detail, now); return true; }
  }
  return false;
}

// ---------- code updates ----------
// A path inside a Homebrew Cellar version folder (<prefix>/Cellar/<name>/<version>/...) is
// mapped to <prefix>/opt/<name>/..., which stays valid across upgrades, when that exists.
function stablePath(p) {
  const m = p.match(/^(.*)\/Cellar\/([^/]+)\/[^/]+\/(.*)$/);
  if (!m) return p;
  const opt = `${m[1]}/opt/${m[2]}/${m[3]}`;
  return fs.existsSync(opt) ? opt : p;
}

const CODE_DIR = stablePath(__dirname);

// Fingerprint of the service code on disk (names, sizes and modification times) and of the
// plugin manifest, which holds the version.
function codeStamp() {
  try {
    const files = fs.readdirSync(CODE_DIR).filter((f) => f.endsWith('.js')).sort().map((f) => path.join(CODE_DIR, f));
    files.push(path.join(CODE_DIR, 'public', 'index.html'), path.join(CODE_DIR, '..', '.claude-plugin', 'plugin.json'));
    return JSON.stringify(files.map((f) => { const st = fs.statSync(f); return [path.basename(f), st.size, st.mtimeMs]; }));
  } catch { return null; }
}

const startStamp = DEMO ? null : codeStamp();
let pendingStamp = null;   // changed code seen on the last tick
let rejectedStamp = null;  // code that failed its check or didn't start; not tried again
let handingOver = false;

// When the code on disk changed (git pull, brew upgrade) and stayed unchanged for one more
// tick, hands over to the new version. The new code must pass `node --check`.
function checkCodeUpdate() {
  if (!startStamp || handingOver) return;
  const stamp = codeStamp();
  if (!stamp || stamp === startStamp || stamp === rejectedStamp) { pendingStamp = null; return; }
  if (stamp !== pendingStamp) { pendingStamp = stamp; return; }
  pendingStamp = null;
  const node = stablePath(process.execPath);
  try {
    for (const f of fs.readdirSync(CODE_DIR).filter((x) => x.endsWith('.js'))) execFileSync(node, ['--check', path.join(CODE_DIR, f)], { stdio: 'ignore', timeout: 5000 });
  } catch { rejectedStamp = stamp; return; }
  handOver(node, stamp);
}

// Hands the port to the new version: saves state, stops listening, starts the new service and
// exits once it reports that it is listening. If it exits or doesn't report within 15 s, this
// version listens again and keeps running. Keep-awake stays held throughout.
function handOver(node, stamp) {
  handingOver = true;
  saveNow();
  let child;
  try {
    child = spawn(node, [path.join(CODE_DIR, 'server.js'), '--takeover'], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: process.env });
  } catch { handingOver = false; rejectedStamp = stamp; return; }
  let timer = null;
  const fail = () => {
    if (!handingOver) return;
    handingOver = false; rejectedStamp = stamp; clearTimeout(timer);
    try { child.kill(); } catch { /* already exited */ }
    if (!server.listening) server.listen(PORT, HOST);
  };
  timer = setTimeout(fail, 15e3);
  child.on('message', (m) => { if (m === 'ready' && handingOver) { keepAwake.stop(); process.exit(0); } });
  child.on('exit', fail);
  child.on('error', fail);
  for (const res of clients) res.end();
  server.close();
}

function updateKeepAwake() {
  return keepAwake.update([...agents.values()], config.keepAwake);
}

// ---------- views ----------
// Name shown in lists: the project with the app it runs in, e.g. "web-app (PyCharm)".
function displayName(project, terminal) {
  return terminal && project !== 'Claude app' ? `${project} (${terminal})` : project;
}

// The session as notifications show it: named with its app.
function named(a) {
  return { ...a, project: displayName(a.project, describeTerminal(a.loc)) };
}

// A session that is done or sleeping with no activity for config.hideIdleHours hours: left out
// of `agents` (menu, widget, compact window, claude-s status) and listed under `idle`.
function isIdle(a, now) {
  return config.hideIdleHours > 0 && (a.status === 'done' || a.status === 'sleeping') && now - a.lastActivity >= config.hideIdleHours * 3600e3;
}

function snapshot() {
  const now = Date.now();
  const all = [...agents.values()].map((a) => {
    const terminal = describeTerminal(a.loc);
    return {
      id: a.id, slot: a.slot, project: a.project, name: displayName(a.project, terminal), cwd: a.cwd, branch: a.branch,
      status: a.status, label: LABEL[a.status], color: COLOR[a.status],
      detail: a.detail, prompt: a.prompt, since: a.since, startedAt: a.startedAt,
      lastActivity: a.lastActivity, subagents: a.subagents, tool: a.pendingTool,
      terminal,
      approval: a.status === 'waiting' ? a.approval : undefined,
    };
  });
  all.sort((x, y) => STATUSES.indexOf(x.status) - STATUSES.indexOf(y.status) || x.slot - y.slot);
  const list = all.filter((a) => !isIdle(a, now));
  const idle = all.filter((a) => isIdle(a, now));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const a of list) counts[a.status]++;
  const names = new Map(all.map((a) => [a.id, a.name]));
  return {
    agents: list, idle, counts, labels: LABEL, colors: COLOR, ts: now,
    approvals: approvalsList([...agents.values()]).map((ap) => ({ ...ap, name: names.get(ap.id) || ap.project })),
    keepAwake: keepAwake.state(),
    config,
  };
}

// Where a session runs, for display: "PyCharm", "iTerm2 · tmux". Long app names are shortened.
const SHORT_APP = { 'Visual Studio Code': 'VS Code', 'Visual Studio Code - Insiders': 'VS Code Insiders' };
function describeTerminal(loc) {
  if (!loc) return null;
  const app = appName(loc);
  return [SHORT_APP[app] || app, loc.tmuxPane ? 'tmux' : null].filter(Boolean).join(' · ') || null;
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
  const click = (a) => `bash="${NODE_BIN}" param1="${FOCUS_CLI}" param2=${a.id} param3=menubar terminal=false refresh=true`;

  if (s.approvals.length) {
    lines.push(`Needs your approval (${s.approvals.length}) | size=11 color=#F5A524`);
    for (const ap of s.approvals) {
      const a = s.agents.find((x) => x.id === ap.id);
      lines.push(`🟠 ${ap.slot}. ${sbText(ap.name)} · ${sbText(ap.detail).slice(0, 60)} · ${ago(now - ap.since)} | ${click(a)} tooltip="${sbText(ap.detail).slice(0, 160)}"`);
    }
    lines.push('---');
  }
  const others = s.agents.filter((a) => a.status !== 'waiting');
  for (const a of others) {
    const txt = sbText(`${DOT[a.status] || '•'} ${a.slot}. ${a.name} — ${a.label}`);
    const tip = sbText([a.detail, a.terminal].filter(Boolean).join(' · ')).slice(0, 160);
    lines.push(`${txt} | ${click(a)}${tip ? ` tooltip="${tip}"` : ''}`);
  }
  if (!s.agents.length) lines.push('No agents');
  if (s.idle.length) {
    const h = config.hideIdleHours;
    lines.push(`+${s.idle.length} idle · no activity for ${Number.isInteger(h) ? h : h.toFixed(1)} h · on the dashboard | size=12 color=#8B8FA3`);
  }

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
// Menu clicks run these; Homebrew paths are given in their upgrade-proof form.
const FOCUS_CLI = path.join(stablePath(__dirname), 'focus-cli.js');
const NODE_BIN = stablePath(process.execPath);

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

    if (p === '/event') {
      if (apply(body)) broadcast();
      res.writeHead(204, { 'X-Agent-Status-Version': String(VERSION || '') });
      return res.end();
    }

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
  if (p === '/health') return send(res, 200, { ok: true, agents: agents.size, demo: DEMO, pid: process.pid, version: VERSION });
  if (p === '/api/agents') return send(res, 200, snapshot());
  if (p === '/api/config') return send(res, 200, config);
  if (p === '/api/compat') return send(res, 200, compat.snapshot());
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

let listenTries = 0;
server.on('error', (e) => {
  // When taking over, the previous instance is still releasing the port: retry for up to 10 s.
  if (e.code === 'EADDRINUSE' && TAKEOVER && ++listenTries < 40) { setTimeout(() => server.listen(PORT, HOST), 250); return; }
  if (e.code === 'EADDRINUSE') process.exit(0); // port already served by a running instance
  console.error(e); process.exit(1);
});

load();
server.listen(PORT, HOST, () => {
  console.log(`agent-status on http://${HOST}:${PORT}/${DEMO ? '  (demo mode)' : ''}`);
  // Tells the instance that handed over that this one is serving.
  if (TAKEOVER && process.send) { process.send('ready'); process.disconnect(); }
  updateKeepAwake();
  if (DEMO) require('./demo').start(apply, broadcast);
});
