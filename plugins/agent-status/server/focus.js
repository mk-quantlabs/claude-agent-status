// Bring the window of an agent's session to the front.
// Only ever *focuses* existing windows: it never opens a project, folder or new window.
// Values come from our own hooks but are still validated, and every command runs
// through execFile (no shell).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const RE = {
  tty: /^\/dev\/tty[\w]+$/,
  pane: /^%\d+$/,
  uuid: /^[0-9A-Fa-f-]{36}$/,
  bundle: /^[\w.-]+$/,
  num: /^\d+$/,
  app: /^\/[^\0]*\.app$/,
};

function run(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve({ ok: !err, out: (stdout || '').trim(), err }));
  });
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

// Any other app (JetBrains IDEs, VS Code, Cursor, Ghostty, ...): bring the app forward and raise
// its window whose title contains the project name. Needs Accessibility permission to pick the
// window; without it the app is still brought forward.
const RAISE = `on run argv
  set thePid to (item 1 of argv) as integer
  set needle to item 2 of argv
  tell application "System Events"
    set p to first process whose unix id is thePid
    set frontmost of p to true
    repeat with w in windows of p
      if name of w contains needle then
        perform action "AXRaise" of w
        return "ok"
      end if
    end repeat
  end tell
  return "app"
end run`;

const TERM_PROGRAM_APP = {
  'iTerm.app': 'iTerm2', iTerm2: 'iTerm2', Apple_Terminal: 'Terminal', ghostty: 'Ghostty', WezTerm: 'WezTerm',
  WarpTerminal: 'Warp', vscode: 'Visual Studio Code',
};

function appName(loc) {
  if (loc.hostApp === 'iTerm2') return 'iTerm2';
  if (loc.hostApp) return path.basename(loc.hostApp, '.app');
  return TERM_PROGRAM_APP[loc.termProgram] || TERM_PROGRAM_APP[loc.lcTerminal] || null;
}

async function focusTmux(loc) {
  if (!loc.tmuxPane || !RE.pane.test(loc.tmuxPane)) return false;
  const sock = loc.tmux ? String(loc.tmux).split(',')[0] : null;
  const base = sock && sock.startsWith('/') ? ['-S', sock] : [];
  const a = await run('tmux', [...base, 'switch-client', '-t', loc.tmuxPane]);
  const b = await run('tmux', [...base, 'select-window', '-t', loc.tmuxPane]);
  const c = await run('tmux', [...base, 'select-pane', '-t', loc.tmuxPane]);
  return a.ok || b.ok || c.ok;
}

async function activate(loc, name) {
  if (loc.hostApp && RE.app.test(loc.hostApp) && fs.existsSync(loc.hostApp)) {
    return (await run('open', ['-a', loc.hostApp])).ok; // no path argument: activates, never opens anything
  }
  if (name) return (await run('open', ['-a', name])).ok;
  return false;
}

async function focusMac(agent, loc) {
  const name = appName(loc);
  const project = agent.project || '';

  if (name === 'iTerm2') {
    const id = loc.itermSession && String(loc.itermSession).split(':').pop();
    if (id && RE.uuid.test(id)) {
      const r = await run('osascript', ['-e', ITERM, id]);
      if (r.out === 'ok') return 'iTerm2 tab';
    }
    return (await activate(loc, 'iTerm')) ? 'iTerm2' : null;
  }

  if (name === 'Terminal') {
    if (loc.tty && RE.tty.test(loc.tty)) {
      const r = await run('osascript', ['-e', TERMINAL, loc.tty]);
      if (r.out === 'ok') return 'Terminal tab';
    }
    return (await activate(loc, 'Terminal')) ? 'Terminal' : null;
  }

  if (name === 'WezTerm' && loc.weztermPane && RE.num.test(loc.weztermPane)) {
    await run('wezterm', ['cli', 'activate-pane', '--pane-id', loc.weztermPane]);
  }
  if (loc.kittyWindow && RE.num.test(loc.kittyWindow)) {
    await run('kitten', ['@', 'focus-window', '--match', `id:${loc.kittyWindow}`]);
  }

  // IDEs and everything else: raise the project's window in the running app.
  if (loc.hostPid && RE.num.test(String(loc.hostPid)) && project) {
    const r = await run('osascript', ['-e', RAISE, String(loc.hostPid), project]);
    if (r.out === 'ok') return `${name} window`;
    if (r.out === 'app') return name;
  }
  return (await activate(loc, name)) ? name : null;
}

async function focusLinux(agent, loc) {
  const name = loc.termProgram || loc.lcTerminal;
  if (name) {
    const r = await run('wmctrl', ['-x', '-a', name]);
    if (r.ok) return 'wmctrl';
  }
  return null;
}

async function focus(agent) {
  const loc = agent.loc || {};
  const steps = [];
  if (await focusTmux(loc)) steps.push('tmux');
  let app = null;
  if (process.platform === 'darwin') app = await focusMac(agent, loc);
  else if (process.platform === 'linux') app = await focusLinux(agent, loc);
  if (app) steps.push(app);
  return { ok: steps.length > 0, method: steps.join(' + ') || 'none' };
}

module.exports = { focus, appName };
