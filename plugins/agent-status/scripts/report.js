#!/usr/bin/env node
// Claude Code hook -> agent-status daemon.
// Reads the hook payload from stdin, trims it to what the board needs and POSTs it
// to the local daemon. Starts the daemon if it isn't running. Never blocks Claude:
// always exits 0, hard deadline ~1.5s, prints nothing.
'use strict';
const http = require('http');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PORT = Number(process.env.AGENT_STATUS_PORT) || 4317;
const HOST = '127.0.0.1';
const SERVER = path.join(__dirname, '..', 'server', 'server.js');

setTimeout(() => process.exit(0), 1500).unref();

function clip(s, n) {
  if (s == null) return undefined;
  s = typeof s === 'string' ? s : JSON.stringify(s);
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
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

// Walk up the process tree once (single `ps` call) to find:
//  - pid:     the Claude Code process (first ancestor that isn't a shell). The daemon uses it
//             to drop sessions whose process is gone (closed tab, Ctrl+C, crash).
//  - hostApp: the GUI app the session really runs in (iTerm, PyCharm, Rider, VS Code, ...),
//             found from the process tree rather than env vars, which IDEs often inherit
//             from whatever terminal launched them.
const SHELLS = /^-?(sh|bash|zsh|dash|fish|ksh|login)$/;
function processInfo() {
  const out = {};
  try {
    const table = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 600, maxBuffer: 8 << 20 });
    const procs = new Map();
    for (const line of table.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
      if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3] });
    }
    let pid = process.ppid;
    for (let i = 0; i < 30 && pid > 1; i++) {
      const p = procs.get(pid);
      if (!p) break;
      if (!out.pid && !SHELLS.test(path.basename(p.comm))) out.pid = pid;
      const app = p.comm.match(/^(\/.*?\.app)\/Contents\//);
      if (app) {
        // Helpers (e.g. "Code Helper") live inside the main bundle: climb to the topmost
        // process of the same app, which is the one that owns the windows.
        out.hostApp = app[1]; out.hostPid = pid;
        for (let q = procs.get(p.ppid), qpid = p.ppid; q && q.comm.startsWith(app[1] + '/'); qpid = q.ppid, q = procs.get(q.ppid)) out.hostPid = qpid;
        break;
      }
      if (/iTermServer/.test(p.comm)) { out.hostApp = 'iTerm2'; break; } // iTerm's detached session server
      if (/(^|\/)tmux/.test(path.basename(p.comm))) { out.inTmux = true; break; }
      pid = p.ppid;
    }
  } catch { /* ignore */ }
  return out;
}

// Where does this session live? Captured on SessionStart / UserPromptSubmit only.
function location() {
  const e = process.env;
  const pi = processInfo();
  return {
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

function build(h) {
  const ev = h.hook_event_name;
  const out = {
    event: ev,
    session_id: h.session_id,
    cwd: h.cwd || process.env.CLAUDE_PROJECT_DIR,
    ts: Date.now(),
  };
  switch (ev) {
    case 'SessionStart': out.source = h.source; out.loc = location(); break;
    case 'UserPromptSubmit': out.prompt = clip(h.prompt, 160); out.loc = location(); break;
    case 'PreToolUse': out.tool = h.tool_name; out.detail = toolSummary(h.tool_name, h.tool_input); break;
    case 'PostToolUse': out.tool = h.tool_name; break;
    case 'PostToolUseFailure':
      out.tool = h.tool_name; out.error = clip(h.error, 200); out.is_interrupt = !!h.is_interrupt; break;
    case 'Notification':
      out.notification_type = h.notification_type; out.message = clip(h.message, 200); break;
    case 'StopFailure': out.error = clip(h.error || h.message || h.reason, 200); break;
    case 'SubagentStart': case 'SubagentStop': out.agent_type = h.agent_type; out.agent_id = h.agent_id; break;
    case 'SessionEnd': out.reason = h.reason; break;
  }
  return out;
}

function post(body) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: HOST, port: PORT, path: '/event', method: 'POST', timeout: 400,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end(data);
  });
}

function startDaemon() {
  try {
    const child = spawn(process.execPath, [SERVER], { detached: true, stdio: 'ignore', env: process.env });
    child.unref();
  } catch { /* ignore */ }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', async () => {
  let h;
  try { h = JSON.parse(raw); } catch { process.exit(0); }
  if (!h || !h.session_id || !h.hook_event_name) process.exit(0);
  const body = build(h);
  if (!(await post(body))) {
    startDaemon();
    await new Promise((r) => setTimeout(r, 450));
    await post(body);
  }
  process.exit(0);
});
