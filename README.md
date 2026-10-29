<p align="center">
  <img src="plugins/agent-status/.claude-plugin/icon.png" width="88" alt="">
</p>

<h1 align="center">Agent Status for Claude Code</h1>

<p align="center">
  A Claude Code plugin that shows all your running sessions in one place: which ones need your approval,<br>
  which are working and which are done. Get told when one needs you or finishes, click one to land in its<br>
  terminal tab or IDE window, and let your agents keep working while your Mac is locked.
</p>

<p align="center">
  <a href="https://github.com/mk-quantlabs/claude-agent-status/actions/workflows/ci.yml"><img src="https://github.com/mk-quantlabs/claude-agent-status/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/mk-quantlabs/claude-agent-status/releases"><img src="https://img.shields.io/github/v/release/mk-quantlabs/claude-agent-status?sort=semver" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/mk-quantlabs/claude-agent-status" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Linux-supported-informational" alt="macOS | Linux">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="Zero dependencies">
</p>

<p align="center">
  <img src="docs/images/click-to-focus.gif" width="720" alt="A session asks for approval: a notification shows the command, the menu bar lists it first, and a click opens its exact iTerm2 tab. With the screen locked the Mac stays awake and a notification says a long task is done; a click opens the right project tab in PyCharm.">
  <br><sub>Approval notification → click to the exact tab → lock the screen, agents keep working → "Done" notification → click to the right IDE tab</sub>
</p>

## The problem it solves

Running several Claude Code sessions at once is fast, until:

- one of them sits on a **permission prompt** for ten minutes while you're looking at another window,
- a **long task finishes** and you don't notice,
- you lose time **hunting for the right tab or IDE window**,
- or the **Mac falls asleep** halfway through a refactor you left running.

Agent Status fixes all four. It's a Claude Code plugin plus a small local service: every session reports its state through Claude Code hooks, and you see them all in one place.

## What you get

| | |
|---|---|
| **One board for every session** | Needs approval, working, retrying, sleeping or done, for every session in iTerm2, Terminal, tmux, VS Code, Cursor, Windsurf, JetBrains IDEs or the Claude desktop app. Sessions that need you are always first. |
| **Approval alerts** | A notification the moment a session asks for permission (also on the lock screen), showing the command it wants to run, and one reminder if it's still waiting after 5 minutes. |
| **"Done" notifications for long tasks** | *Done · app-1 (PyCharm): finished after 24 min* when a task of 5+ minutes ends, or *Stopped with an error* when it fails, so you can walk away and come back at the right time. |
| **Click to jump** | Click a session and you're in its exact iTerm2 / Terminal tab, tmux pane, IDE project window or tab, or the Claude app. It only brings existing windows forward: it never opens anything, types anything or approves anything. |
| **A tidy list** | Every session is named with the app it runs in, like `app-1 (PyCharm)`. Sessions you haven't used for 6 hours fold away into a `+N idle` line, and come back when you use them. |
| **Keeps your Mac awake while agents work** | No idle sleep while an agent is working, even with the screen locked; normal sleep returns a minute after they finish. |
| **See it where you like** | Menu bar, web dashboard, compact window, desktop widget, terminal, and an HTTP API with Stream Deck key images. |
| **Stays out of your way** | Local only (`127.0.0.1`, no network requests, no account), zero dependencies, updates apply themselves, and `claude-s doctor` checks that it understands your Claude Code version. |

## How you'd use it

**Run many sessions in parallel.** You have five Claude Code sessions across iTerm2 tabs and IDE windows. One stops to ask for permission to run a command. You get a notification, see in the menu bar which session is waiting and for what, click it, and you're back in that exact terminal tab to answer.

**Start a long refactor and walk away.** The screen locks, but the Mac doesn't go to sleep while the agent is still working, so the task finishes. When it's done you get a notification with how long it took, and a minute later normal sleep returns.

**Keep an eye on everything.** Keep the dashboard open on a second monitor, or use Stream Deck keys, to see at a glance which agents are working, which are done and ready for the next prompt, and which hit repeated errors and need a look.

---

## Quick start

macOS, with [Claude Code](https://code.claude.com) installed.

**With Homebrew:**

```bash
brew install mk-quantlabs/tap/agent-status
agent-status-setup
```

**Or from a clone** (needs Node.js 18+):

```bash
git clone https://github.com/mk-quantlabs/claude-agent-status.git ~/claude-agent-status
~/claude-agent-status/install.sh
```

Setup adds the plugin to Claude Code and the icon to the menu bar, so you keep starting Claude the usual way:

```bash
claude
```

That's it: every session shows up in the menu bar.

> With a clone, keep the folder in your home directory, not in `~/Documents`, `~/Desktop` or `~/Downloads`. macOS can stop apps like IDE terminals from reading those folders, and sessions started there won't show up.

## Updating

- **Homebrew:** `brew upgrade agent-status`
- **Clone:** `git -C ~/claude-agent-status pull`

That's all. The plugin is loaded from the installed folder, so new sessions use the new version right away, and the background service notices the new code within seconds and hands over to it, keeping the sessions it shows. If the new code doesn't start, the running version keeps serving. Sessions that were already running pick up new hook settings the next time they start. Coming from 0.2, the old service is replaced automatically by the first hook event after the update.

## Statuses

| | Status | When |
|---|---|---|
| 🟠 | **needs input** | Claude is waiting for your approval or answer (see [Approval alerts](#approval-alerts)) |
| 🔴 | **retry** | Two or more tool failures in a row, or an API error |
| 🔵 | **in progress** | Working on your prompt |
| ⚪ | **sleeping** | New session, idle, or no activity for 3+ minutes |
| 🟢 | **done** | Finished its answer and is waiting for the next prompt |

Each session is shown by its folder name and the app it runs in, for example `web-app (PyCharm)` or `api (iTerm2 · tmux)`. Sessions from the Claude desktop app are shown as `Claude app`. Agents that need you (🟠 🔴) are always listed first.

**When sessions leave the board.** A session disappears as soon as its Claude process exits (you quit it, or close its tab or window). A session you keep open but don't use, such as a finished chat in the Claude app, stays done or sleeping. After **6 hours** without activity it is hidden from the menu, the widget, the compact window and `claude-s status`. The menu then shows `+N idle`, and the dashboard lists these sessions in a folded *idle* section. Send it a prompt and it's back. Sessions that need you or are working are never hidden. Change the time with `claude-s hide-idle 2` (hours), or turn it off with `claude-s hide-idle off`.

## Approval alerts

When a session asks for permission, every surface shows it, together with what it wants to run and how long it has been waiting:

- **Menu bar**: the title turns orange and starts with `⚠ N`; a **Needs your approval** section sits at the top of the menu.
- **Dashboard and compact window**: an orange banner lists the sessions; the browser tab shows `(N) Approval needed`.
- **Desktop widget**, **`claude-s status`** and **Stream Deck keys** (`APPROVE?`) show the same list.
- **macOS notification** when a session starts waiting, also on the lock screen, and **one reminder** if it's still waiting after 5 minutes.

Agent Status never approves anything. Clicking a session only brings its window to the front, so you answer it there.

If you dismiss a request with Esc, it disappears from the board within seconds and no reminder follows. When you approve a command that takes a while, such as a build or a test run, the session shows as working while it runs. Claude Code sends no hook event for either, so Agent Status reads the end of the session's transcript on your disk and looks at the session's processes to see it.

Other dialogs that block a session until you answer, such as MCP sign-in links or notices to acknowledge, show up the same way, with their message.

## Notifications

| Notification | When |
|---|---|
| **Approval needed** · *project (app)* | A session asks for permission. Shows the command it wants to run |
| **Still waiting for approval** · *project (app)* | The same permission prompt is still open after 5 minutes (sent once) |
| **Done** · *project (app)* | A task that ran 5 minutes or longer finished. Shows how long it took and the prompt |
| **Stopped with an error** · *project (app)* | A task that ran 5 minutes or longer ended with an API error, with the error message |

A task is everything from your prompt until Claude finishes its answer. Short tasks don't notify, so you're not pinged for every quick question.

| Command | |
|---|---|
| `claude-s notifications` | Show the current settings |
| `claude-s notifications off` / `on` | All notifications off or on |
| `claude-s notifications done 10` | Notify for tasks of 10+ minutes (any number, `0` for every task) |
| `claude-s notifications done off` | No "done" notifications |
| `claude-s notifications remind 3` / `remind off` | Approval reminder after 3 minutes, or never |
| `claude-s notifications sound on` | Play a sound with notifications (off by default) |

Notifications appear in Notification Center as coming from Script Editor (`osascript`). If you don't see any, check that notifications for **Script Editor** are allowed in System Settings → Notifications. Clicking a notification opens Script Editor; to jump to the session, click it in the menu bar.

## Keep awake while agents work

Locking the screen doesn't stop your agents; the Mac going to sleep does. While at least one agent is working, Agent Status keeps the Mac from idle sleep with macOS's built-in `caffeinate`. The display can still turn off and the screen still locks, and the agents keep running behind the lock screen. One minute after the last agent stops working, normal sleep returns.

The menu bar shows `☕` while the Mac is kept awake. Change the mode with:

| Command | Mode |
|---|---|
| `claude-s awake always` | Keep awake while agents work, on battery too (default) |
| `claude-s awake power` | Only while on the power adapter |
| `claude-s awake off` | Never |
| `claude-s awake` | Show the current mode and state |

Closing the lid on battery still puts the Mac to sleep.

## Where you can see it

### Menu bar (default)

Counts sit in the menu bar: ⚠ needs approval, ↻ retry, ● in progress, ✓ done, ☕ keeping the Mac awake. Sessions that need approval are listed first; each agent is one row with its project and app: hover it for details, click it to jump to it. Sessions idle for 6 hours are folded into a `+N idle` line. The menu only shows status: clicking a session is the only action, besides opening the dashboard. The last line shows the keep-awake state. `install.sh` sets this up using the free [SwiftBar](https://swiftbar.app) app.

<img src="docs/images/menubar.png" width="640" alt="Menu-bar dropdown listing agents with colored status dots">

### Web dashboard

Run `claude-s open`, or go to **http://127.0.0.1:4317**. Each card shows the project, git branch, current tool or prompt, the app it runs in, number of subagents and time in the current status. Idle sessions are in a folded section at the bottom, and you can still click them. Use keys `1`–`9` to jump by slot. Follows your system's light or dark mode.

<img src="docs/images/dashboard.png" width="860" alt="Dashboard with one card per agent">

### Compact window

`claude-s compact` opens a small app window you can keep at the side of your screen.

<img src="docs/images/compact-window.png" width="560" alt="Small window listing agents">

### Desktop widget

`claude-s widget` adds a widget to your desktop using the free [Übersicht](https://tracesof.net/uebersicht/) app.

<img src="docs/images/desktop-widget.png" width="560" alt="Desktop widget listing agents">

### Terminal

`claude-s status` prints the board in your terminal.

<img src="docs/images/terminal.png" width="640" alt="Terminal output of claude-s status">

### Stream Deck (API ready)

Each agent gets a stable slot number, and the daemon serves a ready-made key image and a focus action for every slot. A native Stream Deck plugin isn't included yet. See the [API](#api) section below to wire it up yourself.

<img src="docs/images/stream-deck.png" width="460" alt="Stream Deck keys colored by agent status">

## Click to jump to the session

A click only brings the session's existing window to the front. It never opens or launches anything: no project, folder, window or app.

| Where the session runs | What a click does |
|---|---|
| **iTerm2** | Focuses the exact tab or split |
| **Terminal.app** | Focuses the exact tab |
| **tmux** (any terminal) | Switches to the exact window and pane |
| **JetBrains IDEs** (Rider, PyCharm, IntelliJ IDEA, WebStorm, GoLand…) · *beta* | Brings up the project the session belongs to, whether projects are separate windows or tabs of one window (it selects the project's tab). If it picks the wrong project, please [open an issue](https://github.com/mk-quantlabs/claude-agent-status/issues) with the output of `claude-s debug` |
| **VS Code, Cursor, Windsurf** | Raises that project's window |
| **Claude desktop app** (local Claude Code sessions) | Brings the Claude app to the front. Sessions in its temporary folders are shown as *Claude app* |
| **WezTerm, kitty** | Focuses the pane or window, if the app's CLI is available |
| Ghostty, Warp, others | Raises the project's window, or brings the app to the front |

The app is detected from the process tree, so it works even when an IDE was launched from a terminal.

**macOS permissions.** Menu-bar clicks run inside SwiftBar, so the permissions belong to SwiftBar, whichever terminal your sessions run in:
- **Automation**: on the first click, macOS asks to let SwiftBar control iTerm2, Terminal or System Events. Click **OK**.
- **Accessibility**, needed for IDEs (JetBrains, VS Code…): lets SwiftBar raise the right project window. Go to System Settings → Privacy & Security → Accessibility and turn on SwiftBar.

If a click doesn't switch windows, run `claude-s debug`. It shows where each session was recorded and every step of the last clicks, with the exact error.

## The `claude-s` command

`claude-s` holds the helper commands: status, keep-awake, diagnostics. You can also start sessions with it: it starts the background service and the menu-bar icon, then runs `claude`, adding the plugin only if it isn't installed in Claude Code. Put options before your Claude arguments; anything after `--` is passed to `claude` unchanged.

| Command | What it does |
|---|---|
| `claude-s` | Start Claude with the status board |
| `claude-s dashboard` | Also open the dashboard |
| `claude-s compact` | Also open the compact window |
| `claude-s widget` | Also install the desktop widget (one time) |
| `claude-s menubar` | Also reinstall the menu-bar icon |
| `claude-s -- --resume` | Pass `--resume` (or any other flag) to Claude |
| `claude-s status` | Show the board in the terminal |
| `claude-s focus 3` | Jump to the agent in slot 3 |
| `claude-s open` | Open the dashboard only |
| `claude-s awake [always\|power\|off]` | Show or set the keep-awake mode |
| `claude-s notifications …` | Show or change notification settings (see [Notifications](#notifications)) |
| `claude-s hide-idle [HOURS\|off]` | Hide sessions idle this long from the menu (default 6) |
| `claude-s doctor` | Check the setup and macOS permissions |
| `claude-s debug` | Show where each session runs and what the last clicks did, with exact errors |
| `claude-s restart` / `stop` | Restart or stop the background service |
| `claude-s demo` | Try the board with fake agents |
| `claude-s help` | List all commands |

You can combine options, for example `claude-s dashboard compact`. Add `--no-claude` to run the actions without starting Claude.

## Install options

**Homebrew:** `brew install mk-quantlabs/tap/agent-status`, then `agent-status-setup` (same options as `install.sh`, for example `agent-status-setup --no-menubar`). `claude-s` is on your PATH. To remove: `agent-status-uninstall && brew uninstall agent-status`.

**Without the menu bar:**
```bash
~/claude-agent-status/install.sh --no-menubar
```
Or turn it off later by adding `export AGENT_STATUS_MENUBAR=0` to `~/.zshrc`.

**Without installing the plugin in Claude Code:**
```bash
~/claude-agent-status/install.sh --no-plugin
```
Then start sessions with `claude-s`, which loads the plugin for that session only.

**Plugin from GitHub instead of your local folder** (gets what's released on `main`; update with `claude plugin marketplace update agent-status`):
```bash
claude plugin marketplace add mk-quantlabs/claude-agent-status
claude plugin install agent-status@agent-status
```

**Manual setup, without the installer:**
```bash
claude plugin marketplace add ~/claude-agent-status
claude plugin install agent-status@agent-status
echo "alias claude-s='~/claude-agent-status/bin/claude-s'" >> ~/.zshrc
```

**Turn the plugin off for a while:** `claude plugin disable agent-status@agent-status` (and `enable` to turn it back on).

**Try it without Claude:**
```bash
~/claude-agent-status/bin/claude-s demo
```

**Uninstall:**
```bash
~/claude-agent-status/uninstall.sh && rm -rf ~/claude-agent-status
```

## How it works

```
Claude Code sessions ──hooks──▶ local service (127.0.0.1:4317) ──▶ menu bar · dashboard · widget · terminal
                                                              └──▶ JSON / live stream ──▶ Stream Deck, your own tools
```

1. The plugin registers [Claude Code hooks](https://code.claude.com/docs/en/hooks) for prompt submission, tool use, notifications, stop and session end. Each hook sends a small JSON event to the local service. Hooks never block Claude: they have a short timeout and always exit cleanly.
2. The service turns those events into a status for each session. It also records where the session runs (terminal app, tab, tmux pane, IDE) so a click can bring you back to it.
3. Every few seconds it checks that each session's Claude process is still alive and drops the ones that have exited, sends approval reminders that are due, and hands over to new code if its code on disk was updated.
4. Where Claude Code sends no event (an approved command that is still running, a request interrupted with Esc), it looks at the session's processes and at the end of the session's transcript on your disk.
5. It also keeps a record of which hook events arrive and of anything in them it doesn't understand, which `claude-s doctor` shows. If a Claude Code release changes what its hooks send, you see it there instead of the board quietly going wrong.

No dependencies beyond Node.js. The service listens on `127.0.0.1` only, rejects requests sent with any other host name, and makes no network requests.

**Checked daily against the latest Claude Code.** Besides unit and integration tests on macOS and Linux, CI runs real Claude Code sessions with the plugin every day, using the latest Claude Code and a local stand-in for the Anthropic API: a scripted session that checks every hook event the board relies on arrives with the fields it reads, and an interactive one in a pseudo-terminal that hits a permission prompt, dismisses it with Esc, approves a long-running command and quits, checking the board and the notifications at each step.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/agents` | Agents (each with `name`, e.g. `app-1 (PyCharm)`), hidden `idle` agents, counts per status, pending `approvals`, `keepAwake` state and `config` |
| `GET /api/stream` | Server-sent events, pushed on every change |
| `GET /api/slot/N` | One slot as JSON |
| `GET /api/slot/N.svg` | 144×144 key image for slot N |
| `POST /api/slot/N/focus` | Focus the agent in slot N |
| `POST /api/agents/:id/focus` | Focus an agent by session id |
| `POST /api/agents/:id/dismiss` | Remove an agent from the board |
| `POST /api/clear` | Clear agents by status, e.g. `{"statuses":["done"]}` |
| `GET /api/swiftbar` | Menu text in SwiftBar / xbar format |
| `GET /api/config` | Settings (see [Configuration](#configuration)) |
| `POST /api/config` | Change settings, e.g. `{"keepAwake":"power"}`; saved to `config.json` |
| `GET /api/compat` | Hook events received and anything unexpected in them |
| `GET /health` | Service status, version and process id |

POST requests must use `Content-Type: application/json`.

## Configuration

Settings changed with `claude-s awake`, `claude-s notifications` or `claude-s hide-idle` are saved in `~/.claude/agent-status/config.json`:

| Setting | Default | |
|---|---|---|
| `keepAwake` | `always` | `always`, `power` (only on the power adapter) or `off` |
| `systemNotifications` | `true` | All notifications on or off |
| `notifyDone` | `true` | Notify when a long task finishes or fails |
| `longTaskMin` | `5` | Minimum task length for that notification, in minutes |
| `approvalReminderMin` | `5` | Remind about a pending approval after this many minutes; `0` for never |
| `notificationSound` | `false` | Play a sound with notifications |
| `hideIdleHours` | `6` | Hide sessions that are done or sleeping with no activity for this many hours from the menu and other compact views; `0` for never |

These environment variables are read when the service starts:

| Variable | Default | |
|---|---|---|
| `AGENT_STATUS_PORT` | `4317` | Port of the local service |
| `AGENT_STATUS_STALL_MIN` | `3` | Minutes without activity before a working agent counts as sleeping |
| `AGENT_STATUS_MENUBAR` | `1` | Set to `0` to stop `claude-s` from setting up the menu bar |
| `AGENT_STATUS_DIR` | `~/.claude/agent-status` | Where session state is kept between restarts |

## Troubleshooting

Run `claude-s doctor` first. It checks the setup, restarts the service, tests the macOS permissions, shows the notification settings and your Claude Code version, and reports anything in the hook events this version doesn't understand.

- **A session doesn't show up.** Check that the plugin is enabled (`claude plugin list`), or start the session with `claude-s`; then send it a prompt. If it was started from an IDE terminal, check that the folder isn't in `~/Documents`, `~/Desktop` or `~/Downloads` (see Quick start).
- **The menu bar shows `◌`.** The service isn't running. It starts with the next `claude-s`, or run `claude-s restart`.
- **A click doesn't switch windows.** Run `claude-s debug` and look at the ✗ step. `not authorized` or `-1743` means SwiftBar needs the Automation or Accessibility permission (see [Click to jump to the session](#click-to-jump-to-the-session)). Sessions started before an update record their window on the next prompt.
- **Status looks wrong.** `claude-s restart` resets the service. Live sessions reappear after their next event.
- **Doctor reports unknown hook events or missing fields.** Claude Code changed what its hooks send. Update Agent Status; if the report stays, please open an issue with the doctor output.
- **No notifications appear.** Allow notifications for **Script Editor** in System Settings → Notifications, and check `claude-s notifications`.

## Limitations

- Keep awake can't prevent sleep when the lid is closed on battery power.
- Shows Claude Code sessions on this computer only. Cloud sessions and claude.ai chats don't run local hooks.
- Claude Code has no "retry" event, so **retry** is inferred from repeated tool failures.
- Notifications use macOS Notification Center; on Linux there are none yet.
- If a subagent waits for permission while another runs an allowed command at the same moment, the session can show as working instead of waiting.
- JetBrains support is in beta: with several projects open, the click may not always land on the right project.
- In JetBrains IDEs and VS Code, a click switches to the right project window, but it can't select a specific terminal tab inside the IDE. For exact-tab jumps, run sessions in iTerm2, Terminal or tmux.
- The menu bar and desktop widget are macOS-only. The dashboard, terminal view and tmux focus also work on Linux.

## FAQ

### How do I see all my running Claude Code sessions at once?
Install Agent Status. Every Claude Code session reports its state through hooks, and the menu bar lists each one as needs approval, retry, in progress, sleeping or done. `claude-s open` shows the same in a local web dashboard, and `claude-s status` in the terminal.

### How do I get notified when Claude Code needs permission?
Agent Status sends a macOS notification the moment a session starts waiting for approval, also on the lock screen, and lists waiting sessions first on every surface, with the command they want to run. Turn the notification off with `claude-s notifications off`.

### How do I get notified when a long Claude Code task finishes?
Agent Status notifies you when a task that ran 5 minutes or longer finishes (*Done · project: finished after 24 min*) or stops with an API error. Change the threshold with `claude-s notifications done 10`, or turn it off with `claude-s notifications done off`.

### How do I switch between multiple Claude Code sessions quickly?
Click a session in the menu bar or dashboard. It brings that session's existing iTerm2 or Terminal tab, tmux pane, or IDE window to the front. It never opens a new window or types anything.

### How do I keep my Mac awake while Claude Code is running?
Agent Status does it for you: while at least one agent is working, it holds macOS's `caffeinate` so the Mac doesn't idle-sleep, and releases it one minute after work stops. Choose when with `claude-s awake always|power|off`.

### Does Claude Code keep working when my Mac is locked?
Yes. Locking never stops it; sleep does. While an agent works, Agent Status keeps the Mac from idle sleep, so you can lock it and walk away. Closing the lid on battery still sleeps the Mac.

### Does it work with VS Code, Cursor or JetBrains IDEs (PyCharm, IntelliJ IDEA, Rider)?
Yes. Sessions in any terminal or IDE show up. A click raises the right project window in VS Code, Cursor, Windsurf and JetBrains IDEs, and selects the project's tab in a JetBrains window (beta), but it can't select a terminal tab inside the IDE.

### Does it work with the Claude desktop app?
Yes, for Claude Code sessions the app runs on your Mac. They show up as `Claude app`, and a click brings the app to the front.

### Can I approve a request from the menu bar?
No, by design. A click only takes you to the session; you answer it there.

### Does it drain my battery?
Only while agents are working, and for one minute after. `claude-s awake power` keeps the Mac awake only on the power adapter; `claude-s awake off` turns it off.

### Which sessions show up?
Claude Code sessions running on this Mac, from any terminal, IDE or the Claude desktop app, once the plugin is installed. Cloud sessions and claude.ai chats run elsewhere and can't be seen.

### Do I have to use `claude-s`?
No. After `install.sh`, plain `claude` reports its status. `claude-s` is for the helper commands.

### Why does a session I'm not using still show up?
A session stays on the board while its Claude process runs, even if you're done with it. Agent Status hides sessions that have been idle for 6 hours (change it with `claude-s hide-idle HOURS`), and removes them as soon as you quit them.

### Does it send any data anywhere?
No. The service listens on `127.0.0.1` only, keeps its state in `~/.claude/agent-status` and makes no network requests.

### What happens when Claude Code updates?
Usually nothing: Agent Status relies on Claude Code's documented hooks. CI runs a real session with the latest Claude Code every day, so a change that breaks something shows up there first, and `claude-s doctor` shows on your machine whether every hook event arrives as expected.

### How do I update Agent Status?
`brew upgrade agent-status`, or `git pull` in your clone. Nothing else: the background service hands over to the new version by itself.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Ideas for what's next:

- A native Stream Deck plugin with live key colors
- Precise tab focus for Ghostty, Warp and IDE terminals
- Windows support for click-to-focus
- Notifications on Linux


## License

[MIT](LICENSE)

---

*Not affiliated with Anthropic. Claude and Claude Code are trademarks of Anthropic.*
