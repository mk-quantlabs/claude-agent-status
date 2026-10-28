# Changelog

## 0.2.1

- `install.sh` installs the plugin in Claude Code (loaded in place from the cloned folder), so plain `claude` reports its status; `--no-plugin` skips it. `uninstall.sh` removes it.
- `claude-s` runs plain `claude` when the plugin is installed in Claude Code, so it is never loaded twice.
- `claude-s doctor` shows whether the plugin is installed in Claude Code.
- README: highlights, recommended install, FAQ.

## 0.2.0

- **Keep awake while agents work**: `caffeinate` keeps the Mac from idle sleep while at least one agent works, including behind the lock screen; released one minute after work stops. Modes `always` (default), `power`, `off` via `claude-s awake`. ☕ shows while it is active.
- **Approval alerts**: sessions waiting for permission are shown first on every surface (menu bar, dashboard, compact window, desktop widget, `claude-s status`, Stream Deck keys) with the command they want to run and how long they have waited.
- macOS notification when a session starts waiting for approval (`claude-s notifications on|off`).
- Settings saved in `config.json`; `GET`/`POST /api/config`.
- The menu bar is status only: clicking a session navigates to it; nothing is ever approved from Agent Status.

## 0.1.0

First public release.

- Claude Code plugin: hooks report every session's status to a local daemon
- Statuses: needs input, retry, in progress, sleeping, done; only live sessions are shown
- Click-to-focus that only raises the session's existing window and never opens or launches anything:
  exact tab in iTerm2 / Terminal.app / tmux, the open project's window in VS Code, Cursor, Windsurf and JetBrains IDEs (beta)
- The host app is detected from the process tree, so IDEs launched from a terminal are recognised correctly
- Displays: menu bar (default), web dashboard, compact window, desktop widget, terminal (`claude-s status`)
- Stream Deck-ready API: key images and focus endpoints per slot
- Menu-bar clicks run inside SwiftBar, so macOS permissions don't depend on which terminal started the service
- `claude-s` launcher with `doctor` (setup check) and `debug` (where each session runs and why a click failed), `install.sh` / `uninstall.sh`
- Menu bar shows exactly one row per agent; details in the tooltip
- Zero dependencies (Node 18+)
