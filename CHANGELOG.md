# Changelog

## 0.1.0

First public release.

- Claude Code plugin: hooks report every session's status to a local daemon
- Statuses: needs input, retry, in progress, sleeping, done; only live sessions are shown
- Click-to-focus that only raises the session's existing window and never opens or launches anything:
  exact tab in iTerm2 / Terminal.app / tmux, the open project's window in JetBrains IDEs, VS Code, Cursor, Windsurf
- The host app is detected from the process tree, so IDEs launched from a terminal are recognised correctly
- Displays: menu bar (default), web dashboard, compact window, desktop widget, terminal (`claude-s status`)
- Stream Deck-ready API: key images and focus endpoints per slot
- Menu-bar clicks run inside SwiftBar, so macOS permissions don't depend on which terminal started the service
- `claude-s` launcher with `doctor` (setup check) and `debug` (where each session runs and why a click failed), `install.sh` / `uninstall.sh`
- Menu bar shows exactly one row per agent; details in the tooltip
- Zero dependencies (Node 18+)
