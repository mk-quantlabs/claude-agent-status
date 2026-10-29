# Changelog

## Unreleased

- Homebrew formula: uses the Node.js already on your PATH instead of depending on Homebrew's `node`, which could install a second copy or build it from source.

## 0.3.0

- **Notifications when long tasks end**: *Done · project: finished after 24 min* when a task of 5+ minutes finishes, *Stopped with an error* when it ends with an API error. `claude-s notifications done on|off|MIN`.
- **Approval reminder**: one more notification when a permission prompt is still pending after 5 minutes. `claude-s notifications remind MIN|off`.
- **An approved command shows as working while it runs.** Claude Code sends no hook event when you approve a command, only when it finishes; the service now sees the command's shell start under the session, so a long approved build or test run no longer shows as "needs approval", gets no reminder, and keeps the Mac awake.
- Optional sound with notifications: `claude-s notifications sound on`.
- `claude-s notifications` shows all notification settings.
- **Claude Code compatibility check**: the service records which hook events arrive and anything in them it doesn't understand (unknown events, missing fields, payloads without a session); `claude-s doctor` shows it together with the Claude Code version.
- **A request interrupted with Esc** (including a permission prompt dismissed that way) is cleared from the board within seconds and gets no reminder. Claude Code sends no hook event for it, so the service reads the end of the session's transcript on disk.
- Other dialogs that block a session (`agent_needs_input`, MCP elicitation links) show as needs input, with their message.
- Every new prompt starts a new task, so the duration in a notification is never inflated by an interrupted task.
- Updating from 0.2 is automatic as well: the first hook event after the update replaces the 0.2 service, which can't hand over by itself. Services from 0.3 on are never stopped by hooks; they hand over on their own. Setup restarts a running service so it runs the installed code.
- The hook exits quietly on any error.
- API errors show the message Claude Code reports (for example *API Error: 529 Overloaded*) instead of a generic text.
- **Updates apply themselves**: after `git pull` or `brew upgrade`, the background service hands over to the new code, keeping the sessions it shows. The new code must pass `node --check` and must actually start; otherwise the running version keeps serving and doesn't try that code again.
- **Homebrew**: `brew install mk-quantlabs/tap/agent-status` and `agent-status-setup`; the plugin is registered from Homebrew's upgrade-proof path. `install.sh --no-alias`.
- Menu-bar clicks use upgrade-proof paths for Homebrew's Node.js and Agent Status.
- CI: real Claude Code sessions with the plugin against a local stand-in API, daily with the latest Claude Code (a scripted session, and an interactive one in a pseudo-terminal that goes through a permission prompt, Esc and quit); Homebrew layout and upgrade test; notification, interrupt and self-update tests.
- **Claude desktop app**: local Claude Code sessions from the desktop app show as *Claude app*, and clicking one brings the Claude app to the front (the click used to target the app's bundled Claude Code process, which has no window).
- JetBrains IDEs: clicking a session now selects its project tab when projects are tabs of one window (an AppleScript variable named `kind` made the tab selection fail).
- **Names show the app**: `web-app (PyCharm)`, `api (iTerm2 · tmux)`, on every surface and in notifications.
- **Idle sessions are hidden**: sessions done or sleeping with no activity for 6 hours leave the menu, widget, compact window and `claude-s status` (`+N idle` line; listed in a folded section of the dashboard) and come back with new activity. `claude-s hide-idle HOURS|off`.
- Shell commands typed with `!` show as `! command` and slash commands as `/name args`, instead of the raw markup.
- README: what problem it solves and what you get, notifications, updating; new animation and screenshots. The demo (`claude-s demo`) shows apps, the Claude app and an idle session.

## 0.2.2

- Plugin manifest: `displayName`, `homepage`, `repository` and a fuller description, ready for plugin directories.
- Plugin README describing what the plugin gives on its own and what the full install adds.
- README: clearer intro, FAQ written as the questions people ask, privacy answer.
- CI validates the plugin and marketplace manifests with `claude plugin validate --strict`.

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
