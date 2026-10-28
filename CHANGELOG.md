# Changelog

## Unreleased

- Click never opens anything: it only raises the session's existing window
- The host app (iTerm2, JetBrains IDE, VS Code…) is detected from the process tree instead of environment variables
- Menu bar: one clickable row per agent; details are shown as grey text and in a tooltip

## 0.1.0

First public release.

- Claude Code plugin: hooks report every session's status to a local daemon
- Statuses: needs input, retry, in progress, sleeping, done; only live sessions are shown
- Click-to-focus: tmux, iTerm2, Terminal.app, JetBrains IDEs, VS Code / Cursor / Windsurf, WezTerm, kitty
- Displays: menu bar (default), web dashboard, compact window, desktop widget, terminal (`claude-s status`)
- Stream Deck-ready API: key images and focus endpoints per slot
- `claude-s` launcher, `install.sh` / `uninstall.sh`
- Zero dependencies (Node 18+)
