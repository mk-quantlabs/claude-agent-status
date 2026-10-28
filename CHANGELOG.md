# Changelog

## 0.1.0

First public release.

- Claude Code plugin: hooks report every session's status to a local daemon
- Statuses: needs input, retry, in progress, sleeping, done; only live sessions are shown
- Click-to-focus: tmux, iTerm2, Terminal.app, JetBrains IDEs, VS Code / Cursor / Windsurf, WezTerm, kitty
- Displays: menu bar (default), web dashboard, compact window, desktop widget, terminal (`claude-s status`)
- Stream Deck-ready API: key images and focus endpoints per slot
- `claude-s` launcher, `install.sh` / `uninstall.sh`
- Zero dependencies (Node 18+)
