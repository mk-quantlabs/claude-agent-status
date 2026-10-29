#!/usr/bin/env node
// Claude Code hook: reads the hook payload from stdin, reduces it to the fields the board
// uses (and the names of expected fields that are absent) and POSTs it to the local service,
// starting the service if it isn't running.
// Exits 0 within ~1.5s and prints nothing.
'use strict';
const http = require('http');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PORT = Number(process.env.AGENT_STATUS_PORT) || 4317;
const HOST = '127.0.0.1';
const SERVER = path.join(__dirname, '..', 'server', 'server.js');


function clip(s, n) {
  if (s == null) return undefined;
  s = typeof s === 'string' ? s : JSON.stringify(s);
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Prompt text as shown on the board: a shell command typed with "!" shows as "! command" and a
// slash command as "/name args", instead of the markup Claude Code wraps them in.
function promptText(p) {
  const s = typeof p === 'string' ? p : '';
  const bash = s.match(/<bash-input>([\s\S]*?)<\/bash-input>/);
  if (bash) return `! ${bash[1].trim()}`;
  const cmd = s.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (cmd) {
    const args = s.match(/<command-args>([\s\S]*?)<\/command-args>/);
    return `${cmd[1].trim()}${args && args[1].trim() ? ` ${args[1].trim()}` : ''}`;
  }
  return s;
}

function toolSummary(name, input) {
  if (!input || typeof input !== 'object') return name;
  const v = input.command || input.description || input.file_path || input.path ||
    input.pattern || input.url || input.query || input.prompt || input.subagent_type;
  return v ? `${name}: ${clip(v, 90)}` : name;
}

function ttyOfSelf() {
  try {
    const t = execFileSync('ps', ['-o', 'tty=', '-p', String(process.pid)], { encoding: 'utf8', timeout: 400 }).trim();
    if (!t || t === '?' || t === '??') return undefined;
    return t.startsWith('/dev/') ? t : `/dev/${t}`;
  } catch { return undefined; }
}

// Walks the process tree (one `ps` call) and returns:
//  - pid:     the Claude Code process (first ancestor that isn't a shell)
//  - hostApp: the .app bundle the session runs in (iTerm, PyCharm, VS Code, the Claude app, ...)
//  - hostPid: the main process of that app
//  - inTmux:  true when the session runs inside tmux
const SHELLS = /^-?(sh|bash|zsh|dash|fish|ksh|login)$/;
function processInfo() {
  try {
    const table = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 600, maxBuffer: 8 << 20 });
    return walkProcesses(table, process.ppid);
  } catch { return {}; }
}

// The walk behind processInfo(): `table` is `ps -axo pid=,ppid=,comm=` output, `start` the
// hook's parent process.
function walkProcesses(table, start) {
  const out = {};
  const procs = new Map();
  for (const line of String(table).split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
    if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3] });
  }
  let pid = start;
  for (let i = 0; i < 30 && pid > 1; i++) {
    const p = procs.get(pid);
    if (!p) break;
    if (!out.pid && !SHELLS.test(path.basename(p.comm))) out.pid = pid;
    const app = p.comm.match(/^(\/.*?\.app)\/Contents\//);
    // The session's own process can be packaged as an app (the Claude desktop app runs Claude
    // Code from .../claude-code/<version>/claude.app); the host is the app above it.
    if (app && pid !== out.pid) {
      // Topmost process of the same bundle (the app's main process).
      out.hostApp = app[1]; out.hostPid = pid;
      for (let q = procs.get(p.ppid), qpid = p.ppid; q && q.comm.startsWith(app[1] + '/'); qpid = q.ppid, q = procs.get(q.ppid)) out.hostPid = qpid;
      break;
    }
    if (/iTermServer/.test(p.comm)) { out.hostApp = 'iTerm2'; break; } // iTerm2 session server
    if (/(^|\/)tmux/.test(path.basename(p.comm))) { out.inTmux = true; break; }
    pid = p.ppid;
  }
  return out;
}

// Folders containing `cwd` that have an `.idea` directory (JetBrains project roots), nearest
// first. The project named by the IDE terminal's history-file variable, if present, is first.
function jetbrainsProject(cwd) {
  if (!cwd) return undefined;
  const fs = require('fs');
  const hist = process.env.__INTELLIJ_COMMAND_HISTFILE__ || '';
  const m = path.basename(hist).match(/^(.+?)-history/);
  const hint = m ? m[1] : null;
  const home = require('os').homedir();
  const found = [];
  let dir = cwd;
  for (let i = 0; i < 8 && dir && dir !== '/' && dir !== home; i++) {
    try { if (fs.statSync(path.join(dir, '.idea')).isDirectory()) found.push(dir); } catch { /* none */ }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (hint) { const i = found.findIndex((d) => path.basename(d) === hint); if (i > 0) found.unshift(...found.splice(i, 1)); }
  return found.length ? found : undefined;
}

// Location of the session: process, host app, terminal and IDE details.
// Collected on SessionStart and UserPromptSubmit.
function location(cwd) {
  const e = process.env;
  const pi = processInfo();
  const inJetBrains = /JetBrains/i.test(e.TERMINAL_EMULATOR || '');
  return {
    ideProjects: inJetBrains ? jetbrainsProject(cwd) : undefined,
    pid: pi.pid,
    hostApp: pi.hostApp,
    hostPid: pi.hostPid,
    tty: ttyOfSelf(),
    tmux: e.TMUX || undefined,
    tmuxPane: e.TMUX_PANE || undefined,
    termProgram: e.TERM_PROGRAM || undefined,
    lcTerminal: e.LC_TERMINAL || undefined,
    bundleId: e.__CFBundleIdentifier || undefined,
    itermSession: e.ITERM_SESSION_ID || undefined,
    weztermPane: e.WEZTERM_PANE || undefined,
    kittyWindow: e.KITTY_WINDOW_ID || undefined,
    terminalEmulator: e.TERMINAL_EMULATOR || undefined, // "JetBrains-JediTerm" inside PyCharm/IntelliJ/...
    vscodePid: e.VSCODE_PID || undefined,
    platform: process.platform,
  };
}

// Payload fields the board relies on, per event. Absent ones are reported as `missing`.
const EXPECTED = {
  SessionStart: ['cwd', 'source', 'transcript_path'],
  UserPromptSubmit: ['cwd', 'prompt', 'transcript_path'],
  PreToolUse: ['tool_name', 'tool_input'],
  PostToolUse: ['tool_name'],
  PostToolUseFailure: ['tool_name'],
  Notification: ['notification_type', 'message'],
  StopFailure: ['error'],
};

function build(h) {
  const ev = h.hook_event_name;
  const out = {
    event: ev,
    session_id: h.session_id,
    cwd: h.cwd || process.env.CLAUDE_PROJECT_DIR,
    ts: Date.now(),
  };
  switch (ev) {
    case 'SessionStart': out.source = h.source; out.loc = location(out.cwd); out.transcript = h.transcript_path; break;
    case 'UserPromptSubmit': out.prompt = clip(promptText(h.prompt), 160); out.loc = location(out.cwd); out.transcript = h.transcript_path; break;
    case 'PreToolUse': out.tool = h.tool_name; out.detail = toolSummary(h.tool_name, h.tool_input); out.tool_use_id = clip(h.tool_use_id, 100); break;
    case 'PostToolUse': out.tool = h.tool_name; break;
    case 'PostToolUseFailure':
      out.tool = h.tool_name; out.error = clip(h.error, 200); out.is_interrupt = !!h.is_interrupt; break;
    case 'Notification':
      out.notification_type = h.notification_type; out.message = clip(h.message, 200); break;
    case 'StopFailure':
      out.error = clip(h.error, 60);
      out.message = clip(h.last_assistant_message || h.message, 200);
      break;
    case 'SubagentStart': case 'SubagentStop': out.agent_type = h.agent_type; out.agent_id = h.agent_id; break;
    case 'SessionEnd': out.reason = h.reason; break;
  }
  const missing = (EXPECTED[ev] || []).filter((k) => h[k] === undefined || h[k] === null);
  if (missing.length) out.missing = missing;
  return out;
}

// Sends the event. Resolves with { version } of the service that took it, or null.
function post(body) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: HOST, port: PORT, path: '/event', method: 'POST', timeout: 400,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => { res.resume(); resolve({ version: res.headers['x-agent-status-version'] || null }); });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end(data);
  });
}

function health() {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: '/health', timeout: 300 }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function startDaemon() {
  try {
    const child = spawn(process.execPath, [SERVER], { detached: true, stdio: 'ignore', env: process.env });
    child.unref();
  } catch { /* ignore */ }
}

// A service from before 0.3 (its /health has no version) can't hand over to new code by
// itself: it is stopped, which saves its state, and this version is started in its place.
// Services from 0.3 on update themselves when their code changes.
async function replaceIfPre03(serviceVersion) {
  if (serviceVersion) return;
  const h = await health();
  if (!h || h.version || !Number.isInteger(h.pid)) return;
  try { process.kill(h.pid, 'SIGTERM'); } catch { return; }
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 60));
    try { process.kill(h.pid, 0); } catch { break; }
  }
  startDaemon();
}

function main() {
  setTimeout(() => process.exit(0), 1500).unref();
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  // Any error ends the hook quietly: it must never disturb the session.
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  process.stdin.on('end', async () => {
    let h;
    try { h = JSON.parse(raw); } catch { process.exit(0); }
    if (!h || typeof h !== 'object') process.exit(0);
    // A payload without a session id or event name is reported by its field names only.
    const body = h.session_id && h.hook_event_name
      ? build(h)
      : { event: '_malformed', keys: Object.keys(h).slice(0, 15), ts: Date.now() };
    const sent = await post(body);
    if (!sent) {
      startDaemon();
      await new Promise((r) => setTimeout(r, 450));
      await post(body);
    } else {
      await replaceIfPre03(sent.version);
    }
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = { walkProcesses, build, promptText };
