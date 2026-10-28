// Bring the terminal / editor window of an agent to the front.
// Values come from our own hooks, but are still validated before they reach any
// command, and everything runs through execFile (no shell).
'use strict';
const { execFile } = require('child_process');

const RE = {
  tty: /^\/dev\/tty[\w]+$/,
  pane: /^%\d+$/,
  uuid: /^[0-9A-Fa-f-]{36}$/,
  bundle: /^[\w.-]+$/,
  num: /^\d+$/,
};

function run(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve({ ok: !err, out: (stdout || '').trim(), err }));
  });
}

const ITERM = `on run argv
  set target to item 1 of argv
  tell application "iTerm2"
    activate
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if unique id of s is target then
            select w
            select t
            select s
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "miss"
end run`;

const TERMINAL = `on run argv
  set target to item 1 of argv
  tell application "Terminal"
    activate
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is target then
          set selected of t to true
          set index of w to 1
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "miss"
end run`;

const EDITORS = new Set([
  'com.microsoft.VSCode', 'com.microsoft.VSCodeInsiders', 'com.vscodium',
  'com.todesktop.230313mzl4w4u92', // Cursor
  'com.exafunction.windsurf', 'dev.zed.Zed',
]);

const TERM_PROGRAM_BUNDLE = {
  'iTerm.app': 'com.googlecode.iterm2',
  Apple_Terminal: 'com.apple.Terminal',
  ghostty: 'com.mitchellh.ghostty',
  WezTerm: 'com.github.wez.wezterm',
  WarpTerminal: 'dev.warp.Warp-Stable',
  vscode: 'com.microsoft.VSCode',
};

async function focusTmux(loc) {
  if (!loc.tmuxPane || !RE.pane.test(loc.tmuxPane)) return false;
  const sock = loc.tmux ? String(loc.tmux).split(',')[0] : null;
  const base = sock && sock.startsWith('/') ? ['-S', sock] : [];
  const a = await run('tmux', [...base, 'switch-client', '-t', loc.tmuxPane]);
  const b = await run('tmux', [...base, 'select-window', '-t', loc.tmuxPane]);
  const c = await run('tmux', [...base, 'select-pane', '-t', loc.tmuxPane]);
  return a.ok || b.ok || c.ok;
}

// JetBrains IDEs, most common first. Opening the project folder focuses its window.
const JETBRAINS = [
  'com.jetbrains.pycharm', 'com.jetbrains.pycharm.ce', 'com.jetbrains.intellij', 'com.jetbrains.intellij.ce',
  'com.jetbrains.WebStorm', 'com.jetbrains.goland', 'com.jetbrains.datagrip', 'com.jetbrains.rider',
  'com.jetbrains.CLion', 'com.jetbrains.PhpStorm', 'com.jetbrains.rubymine', 'com.google.android.studio',
];

async function focusJetBrains(agent) {
  for (const id of JETBRAINS) {
    const r = await run('open', ['-b', id, ...(agent.cwd ? [agent.cwd] : [])]);
    if (r.ok) return id.split('.').pop();
  }
  return null;
}

async function focusMac(agent, loc) {
  // IDE terminals inherit env from whatever launched the IDE (often iTerm),
  // so detect them first or we'd focus the wrong app.
  if (loc.terminalEmulator && /JetBrains/i.test(loc.terminalEmulator)) {
    const r = await focusJetBrains(agent);
    if (r) return r;
  }
  if (loc.termProgram === 'vscode' && agent.cwd) {
    const b = EDITORS.has(loc.bundleId) ? loc.bundleId : 'com.microsoft.VSCode';
    const r = await run('open', ['-b', b, agent.cwd]);
    if (r.ok) return 'editor';
  }
  const iterm = loc.itermSession && String(loc.itermSession).split(':').pop();
  const bundle = (loc.bundleId && RE.bundle.test(loc.bundleId)) ? loc.bundleId
    : TERM_PROGRAM_BUNDLE[loc.termProgram] || TERM_PROGRAM_BUNDLE[loc.lcTerminal];

  if (iterm && RE.uuid.test(iterm) && (!bundle || bundle === 'com.googlecode.iterm2')) {
    const r = await run('osascript', ['-e', ITERM, iterm]);
    if (r.out === 'ok') return 'iTerm2';
  }
  if (bundle === 'com.apple.Terminal' && loc.tty && RE.tty.test(loc.tty)) {
    const r = await run('osascript', ['-e', TERMINAL, loc.tty]);
    if (r.out === 'ok') return 'Terminal';
  }
  if (bundle === 'com.github.wez.wezterm' && loc.weztermPane && RE.num.test(loc.weztermPane)) {
    await run('wezterm', ['cli', 'activate-pane', '--pane-id', loc.weztermPane]);
  }
  if (bundle === 'net.kovidgoyal.kitty' && loc.kittyWindow && RE.num.test(loc.kittyWindow)) {
    await run('kitten', ['@', 'focus-window', '--match', `id:${loc.kittyWindow}`]);
  }
  if (bundle && EDITORS.has(bundle) && agent.cwd) {
    // Opening the folder focuses the editor window that already has it open.
    const r = await run('open', ['-b', bundle, agent.cwd]);
    if (r.ok) return 'editor';
  }
  if (bundle) {
    const r = await run('open', ['-b', bundle]);
    if (r.ok) return 'app';
  }
  return null;
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
  return { ok: steps.length > 0, method: steps.join('+') || 'none' };
}

module.exports = { focus };
