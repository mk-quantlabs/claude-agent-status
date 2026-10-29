// Brings the window or tab of an agent's session to the front. Acts only on existing windows
// of running processes. Inputs are validated; commands run through execFile without a shell.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const RE = {
  tty: /^\/dev\/tty[\w]+$/,
  pane: /^%\d+$/,
  uuid: /^[0-9A-Fa-f-]{36}$/,
  num: /^\d+$/,
};

function run(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => resolve({
      ok: !err, out: (stdout || '').trim(), err,
      error: err ? String((stderr || err.message || 'error')).trim().split('\n').filter(Boolean).pop().slice(0, 300) : undefined,
    }));
  });
}

// Appends one step (name, success, output, error) to the trace of a focus attempt.
function step(trace, name, r) {
  trace.push({ step: name, ok: !!(r && r.ok), out: r && r.out ? r.out.slice(0, 120) : undefined, error: r && r.error });
  return r;
}

// iTerm2: select the exact session (tab / split) by its unique id.
const ITERM = `on run argv
  set target to item 1 of argv
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if unique id of s is target then
            select w
            select t
            select s
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "miss"
end run`;

// Terminal.app: select the tab that owns the session's tty.
const TERMINAL = `on run argv
  set target to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is target then
          set selected of t to true
          set index of w to 1
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "miss"
end run`;

// ---- Window / tab navigation ----
//   LIST_WINDOWS   lists the titles of a process's windows and native window tabs
//   chooseTarget() picks the window or tab that belongs to the session
//   SELECT_WINDOW  raises that window or presses that tab
// Works with one window per project, projects as tabs of one window and multiple instances
// of the same app. Uses macOS Accessibility (System Events).
const LIST_WINDOWS = `on run argv
  set thePid to (item 1 of argv) as integer
  set TB to character id 9
  set out to {}
  tell application "System Events"
    set p to first process whose unix id is thePid
    set wi to 0
    repeat with w in windows of p
      set wi to wi + 1
      set wn to ""
      try
        set wn to (name of w) as text
      end try
      set end of out to "W" & TB & wi & TB & wn
      try
        set gi to 0
        repeat with tg in tab groups of w
          set gi to gi + 1
          set bi to 0
          repeat with b in radio buttons of tg
            set bi to bi + 1
            set bn to ""
            try
              set bn to (name of b) as text
            end try
            if bn is "" or bn is "missing value" then
              try
                set bn to (value of attribute "AXTitle" of b) as text
              end try
            end if
            set end of out to "T" & TB & wi & TB & gi & TB & bi & TB & bn
          end repeat
        end repeat
      end try
    end repeat
  end tell
  set AppleScript's text item delimiters to linefeed
  return out as text
end run`;

const SELECT_WINDOW = `on run argv
  set thePid to (item 1 of argv) as integer
  set targetKind to item 2 of argv
  set wi to (item 3 of argv) as integer
  tell application "System Events"
    set p to first process whose unix id is thePid
    set frontmost of p to true
    set w to window wi of p
    if targetKind is "tab" then
      perform action "AXPress" of radio button ((item 5 of argv) as integer) of tab group ((item 4 of argv) as integer) of w
    end if
    perform action "AXRaise" of w
    try
      set value of attribute "AXMain" of w to true
    end try
  end tell
  return "ok"
end run`;

// "W\t1\tproj – file" / "T\t1\t1\t2\tproj – file"  ->  [{ kind, w, g, b, title }]
function parseWindowList(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const f = line.split('\t');
    if (f[0] === 'W' && f.length >= 3) out.push({ kind: 'window', w: Number(f[1]), title: f.slice(2).join('\t') });
    else if (f[0] === 'T' && f.length >= 5) out.push({ kind: 'tab', w: Number(f[1]), g: Number(f[2]), b: Number(f[3]), title: f.slice(4).join('\t') });
  }
  return out;
}

// True when a window/tab title belongs to `needle` (a project name or a ~/path). The title is
// split on " – ", " — ", " - ", " | ", " · " and each part is compared as a whole.
function titleMatches(title, needle) {
  if (!title || !needle) return false;
  const t = String(title).trim();
  const n = String(needle).trim();
  if (!n) return false;
  if (n.includes('/')) { // a path: "proj [~/a/proj] – file" or a terminal title "~/a/proj"
    return t.includes(`[${n}]`) || t.split(/\s[–—\-|·]\s/).some((part) => part.trim() === n);
  }
  return t.split(/\s[–—\-|·]\s/).some((raw) => {
    const part = raw.trim();
    if (part === n || part.startsWith(`${n} [`) || part.startsWith(`${n} (`)) return true;
    return part.includes('/') && !/\s/.test(part) && part.replace(/\/+$/, '').split('/').pop() === n; // "~/a/proj"
  });
}

// Returns the first tab, else window, whose title matches a needle; needles are tried in order.
function chooseTarget(entries, needles) {
  for (const n of needles) {
    const tab = entries.find((e) => e.kind === 'tab' && titleMatches(e.title, n));
    if (tab) return { ...tab, needle: n };
    const win = entries.find((e) => e.kind === 'window' && titleMatches(e.title, n));
    if (win) return { ...win, needle: n };
  }
  return null;
}

// Brings a running process to the front by PID.
const FRONT_PID = `on run argv
  tell application "System Events" to set frontmost of (first process whose unix id is ((item 1 of argv) as integer)) to true
  return "ok"
end run`;

function tildePath(p) {
  const home = require('os').homedir();
  return p === home ? '~' : p.startsWith(home + '/') ? '~' + p.slice(home.length) : p;
}

// Folder name, then its parent: /a/workspace/web-app -> [web-app, workspace]
function windowNeedles(cwd) {
  const out = [];
  let dir = cwd || '';
  for (let i = 0; i < 2 && dir && dir !== '/' && dir !== '.'; i++) {
    const b = path.basename(dir);
    if (b && b.length > 1 && !out.includes(b)) out.push(b);
    dir = path.dirname(dir);
  }
  return out;
}

// Paths of projects marked open (opened="true") in the recentProjects.xml of every installed
// JetBrains IDE; null when no such file can be read.
function openJetBrainsProjects() {
  const os = require('os');
  const base = path.join(os.homedir(), 'Library', 'Application Support', 'JetBrains');
  let dirs;
  try { dirs = fs.readdirSync(base); } catch { return null; }
  const open = new Set();
  let readAny = false;
  for (const d of dirs) {
    const f = path.join(base, d, 'options', 'recentProjects.xml');
    let xml;
    try { xml = fs.readFileSync(f, 'utf8'); } catch { continue; }
    readAny = true;
    const re = /<entry key="([^"]+)">\s*<value>\s*<RecentProjectMetaInfo\b([^>]*)>/g;
    let m;
    while ((m = re.exec(xml))) {
      if (/\bopened="true"/.test(m[2])) open.add(path.resolve(m[1].replace('$USER_HOME$', os.homedir())));
    }
  }
  return readAny ? open : null;
}

function pickOpenJetBrainsProject(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const valid = candidates.filter((c) => typeof c === 'string' && path.isAbsolute(c) && fs.existsSync(path.join(c, '.idea')));
  if (!valid.length) return null;
  const open = openJetBrainsProjects();
  if (open) return valid.find((c) => open.has(path.resolve(c))) || null;
  return valid.length === 1 ? valid[0] : null; // open state unknown: only a single candidate is used
}

const TERM_PROGRAM_APP = {
  'iTerm.app': 'iTerm2', iTerm2: 'iTerm2', Apple_Terminal: 'Terminal', ghostty: 'Ghostty', WezTerm: 'WezTerm',
  WarpTerminal: 'Warp', vscode: 'Visual Studio Code',
};

function appName(loc) {
  if (loc.hostApp === 'iTerm2') return 'iTerm2';
  if (loc.hostApp) return path.basename(loc.hostApp, '.app');
  return TERM_PROGRAM_APP[loc.termProgram] || TERM_PROGRAM_APP[loc.lcTerminal] || null;
}

async function focusTmux(loc, trace) {
  if (!loc.tmuxPane || !RE.pane.test(loc.tmuxPane)) return false;
  const sock = loc.tmux ? String(loc.tmux).split(',')[0] : null;
  const base = sock && sock.startsWith('/') ? ['-S', sock] : [];
  const a = step(trace, 'tmux switch-client', await run('tmux', [...base, 'switch-client', '-t', loc.tmuxPane]));
  const b = step(trace, 'tmux select-window', await run('tmux', [...base, 'select-window', '-t', loc.tmuxPane]));
  const c = step(trace, 'tmux select-pane', await run('tmux', [...base, 'select-pane', '-t', loc.tmuxPane]));
  return a.ok || b.ok || c.ok;
}

async function activate(loc, name, trace) {
  if (loc.hostPid && RE.num.test(String(loc.hostPid))) {
    return step(trace, `bring ${name || 'app'} (pid ${loc.hostPid}) to front`, await run('osascript', ['-e', FRONT_PID, String(loc.hostPid)])).ok;
  }
  if (name && /^[\w .-]+$/.test(name)) {
    return step(trace, `activate ${name}`, await run('osascript', ['-e', `tell application "${name}" to activate`])).ok;
  }
  trace.push({ step: 'activate', ok: false, error: 'app unknown' });
  return false;
}

async function focusMac(agent, loc, trace) {
  const name = appName(loc);
  const project = agent.project || '';
  trace.push({ step: 'detected', ok: true, out: `app=${name || '?'} hostPid=${loc.hostPid || '-'} iterm=${loc.itermSession ? 'yes' : 'no'} tty=${loc.tty || '-'} jetbrains=${/JetBrains/i.test(loc.terminalEmulator || '') ? 'yes' : 'no'}` });

  if (name === 'iTerm2') {
    const id = loc.itermSession && String(loc.itermSession).split(':').pop();
    if (id && RE.uuid.test(id)) {
      const r = step(trace, 'iTerm2: select session', await run('osascript', ['-e', ITERM, id]));
      if (r.out === 'ok') return 'iTerm2 tab';
    } else trace.push({ step: 'iTerm2: select session', ok: false, error: 'no ITERM_SESSION_ID recorded' });
    return (await activate(loc, 'iTerm', trace)) ? 'iTerm2' : null;
  }

  if (name === 'Terminal') {
    if (loc.tty && RE.tty.test(loc.tty)) {
      const r = step(trace, 'Terminal: select tab', await run('osascript', ['-e', TERMINAL, loc.tty]));
      if (r.out === 'ok') return 'Terminal tab';
    } else trace.push({ step: 'Terminal: select tab', ok: false, error: 'no tty recorded' });
    return (await activate(loc, 'Terminal', trace)) ? 'Terminal' : null;
  }

  if (name === 'WezTerm' && loc.weztermPane && RE.num.test(loc.weztermPane)) {
    step(trace, 'wezterm activate-pane', await run('wezterm', ['cli', 'activate-pane', '--pane-id', loc.weztermPane]));
  }
  if (loc.kittyWindow && RE.num.test(loc.kittyWindow)) {
    step(trace, 'kitty focus-window', await run('kitten', ['@', 'focus-window', '--match', `id:${loc.kittyWindow}`]));
  }

  // Window titles to look for: the open JetBrains project (path, then name), then the session
  // folder and its parent.
  const needles = [];
  if (/JetBrains/i.test(loc.terminalEmulator || '')) {
    const proj = pickOpenJetBrainsProject(loc.ideProjects);
    trace.push({ step: 'JetBrains: open project', ok: !!proj, out: proj || undefined, error: proj ? undefined : `none of ${JSON.stringify(loc.ideProjects || [])} is open` });
    if (proj) needles.push(tildePath(proj), path.basename(proj));
  }

  for (const n of windowNeedles(agent.cwd)) if (!needles.includes(n)) needles.push(n);
  if (!needles.length && project) needles.push(project);
  if (loc.hostPid && RE.num.test(String(loc.hostPid)) && needles.length) {
    const list = step(trace, 'read windows and tabs', await run('osascript', ['-e', LIST_WINDOWS, String(loc.hostPid)]));
    if (list.ok) {
      const entries = parseWindowList(list.out);
      const target = chooseTarget(entries, needles);
      trace.push({ step: `choose among ${entries.length} windows/tabs for ${needles.join(' | ')}`, ok: !!target, out: target ? `${target.kind}: ${target.title}` : undefined, error: target ? undefined : `titles: ${entries.map((e) => e.title).join(' | ').slice(0, 250)}` });
      if (target) {
        const args = [String(loc.hostPid), target.kind, String(target.w), String(target.g || 0), String(target.b || 0)];
        const r = step(trace, `select ${target.kind}`, await run('osascript', ['-e', SELECT_WINDOW, ...args]));
        if (r.ok) return `${name || 'app'} ${target.kind} "${target.title}"`;
      }
    }
  }
  return (await activate(loc, name, trace)) ? name : null;
}

async function focusLinux(agent, loc, trace) {
  const name = loc.termProgram || loc.lcTerminal;
  if (name) {
    const r = step(trace, `wmctrl ${name}`, await run('wmctrl', ['-x', '-a', name]));
    if (r.ok) return 'wmctrl';
  }
  return null;
}

async function focus(agent) {
  const loc = agent.loc || {};
  const trace = [];
  const steps = [];
  if (await focusTmux(loc, trace)) steps.push('tmux');
  let app = null;
  if (!agent.loc) trace.push({ step: 'location', ok: false, error: 'no location recorded yet: send the session a prompt' });
  else if (process.platform === 'darwin') app = await focusMac(agent, loc, trace);
  else if (process.platform === 'linux') app = await focusLinux(agent, loc, trace);
  if (app) steps.push(app);
  return { ok: steps.length > 0, method: steps.join(' + ') || 'none', trace };
}

// Checks whether this process may control System Events (Automation) and read windows
// (Accessibility).
async function doctor() {
  if (process.platform !== 'darwin') return { platform: process.platform };
  const a = await run('osascript', ['-e', 'tell application "System Events" to get name of first process'], 8000);
  const b = await run('osascript', ['-e', 'tell application "System Events" to get name of every window of (first process whose frontmost is true)'], 8000);
  const msg = (r) => (r.ok ? 'ok' : r.error || 'error');
  return { platform: 'darwin', automation: msg(a), accessibility: msg(b) };
}

// Appends a focus attempt to focus.log (last 50 entries), shown by `claude-s debug`.
function logAttempt(agent, result, via) {
  try {
    const os = require('os');
    const dir = process.env.AGENT_STATUS_DIR || path.join(os.homedir(), '.claude', 'agent-status');
    const file = path.join(dir, 'focus.log');
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), via, project: agent.project, cwd: agent.cwd, ok: result.ok, method: result.method, trace: result.trace });
    let lines = [];
    try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-49); } catch { /* no log yet */ }
    lines.push(line);
    fs.writeFileSync(file, lines.join('\n') + '\n');
  } catch { /* log file not writable */ }
}

module.exports = { focus, logAttempt, appName, doctor, windowNeedles, pickOpenJetBrainsProject, parseWindowList, titleMatches, chooseTarget, tildePath };
