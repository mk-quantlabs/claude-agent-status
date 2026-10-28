<p align="center">
  <img src="plugins/agent-status/.claude-plugin/icon.png" width="88" alt="">
</p>

<h1 align="center">Agent Status for Claude Code</h1>

<p align="center">
  One place to see every Claude Code session you have running: which ones are working, which need you, which are stuck, and which are done.<br>
  Click one and you're back in its window.
</p>

<p align="center">
  <img src="docs/images/click-to-focus.gif" width="720" alt="Clicking an agent in the menu bar jumps to its iTerm2 tab, then to a JetBrains IDE window">
</p>

---

## Quick start

macOS, with [Claude Code](https://code.claude.com) and Node.js 18+ installed:

```bash
git clone https://github.com/mk-quantlabs/claude-agent-status.git ~/claude-agent-status
~/claude-agent-status/install.sh
```

Open a new terminal, go to any project, and start Claude with:

```bash
claude-s
```

That's it. Run `claude-s` instead of `claude` in each project and the status icon appears in your menu bar.

> Keep the folder in your home directory, not in `~/Documents`, `~/Desktop` or `~/Downloads`. macOS can stop apps like IDE terminals from reading those folders, and sessions started there won't show up.

## Statuses

| | Status | When |
|---|---|---|
| 🟠 | **needs input** | Claude is asking for permission or waiting for your answer |
| 🔴 | **retry** | Two or more tool failures in a row, or an API error |
| 🔵 | **in progress** | Working on your prompt |
| ⚪ | **sleeping** | New session, idle, or no activity for 3+ minutes |
| 🟢 | **done** | Finished its answer and is waiting for the next prompt |

Sessions disappear from the board as soon as their Claude process exits. Agents that need you (🟠 🔴) are always listed first.

## Where you can see it

### Menu bar (default)

Counts sit in the menu bar: ⚠ needs input, ↻ retry, ● in progress, ✓ done. Click an agent to jump to it. `install.sh` sets this up using the free [SwiftBar](https://swiftbar.app) app.

<img src="docs/images/menubar.png" width="640" alt="Menu-bar dropdown listing agents with colored status dots">

### Web dashboard

Run `claude-s open`, or go to **http://127.0.0.1:4317**. Each card shows the project, git branch, current tool or prompt, number of subagents and time in the current status. Use keys `1`–`9` to jump by slot. Follows your system's light or dark mode.

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

| Where the session runs | What a click does |
|---|---|
| **iTerm2** | Focuses the exact tab or split |
| **Terminal.app** | Focuses the exact tab |
| **tmux** (any terminal) | Switches to the exact window and pane |
| **JetBrains IDEs** (Rider, PyCharm, IntelliJ IDEA, WebStorm, GoLand…) | Focuses that project's window |
| **VS Code, Cursor, Windsurf** | Focuses that project's window |
| **WezTerm, kitty** | Focuses the pane or window, if the app's CLI is available |
| Ghostty, Warp, others | Brings the app to the front |

The first time you click, macOS asks whether `node` may control iTerm2 or Terminal. Allow it, or go to System Settings → Privacy & Security → Automation.

## The `claude-s` command

`claude-s` starts Claude Code with this plugin loaded. It also starts the background service and makes sure the menu-bar icon is running. Put options before your Claude arguments. Anything after `--` is passed to `claude` unchanged.

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
| `claude-s restart` / `stop` | Restart or stop the background service |
| `claude-s demo` | Try the board with fake agents |
| `claude-s help` | List all commands |

You can combine options, for example `claude-s dashboard compact`. Add `--no-claude` to run the actions without starting Claude.

## Install options

**Without the menu bar:**
```bash
~/claude-agent-status/install.sh --no-menubar
```
Or turn it off later by adding `export AGENT_STATUS_MENUBAR=0` to `~/.zshrc`.

**Manual setup, without the installer.** Add this line to `~/.zshrc`, then open a new terminal:
```bash
alias claude-s='~/claude-agent-status/bin/claude-s'
```

**As a regular Claude Code plugin**, so plain `claude` loads it in every session. Run these inside Claude Code:
```
/plugin marketplace add mk-quantlabs/claude-agent-status
/plugin install agent-status@agent-status
```
After that, start Claude with `claude` rather than `claude-s`, or the plugin is loaded twice. You can still use `claude-s status`, `open` and the other commands that don't start Claude.

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
3. Every few seconds it checks that each session's Claude process is still alive and drops the ones that have exited.

No dependencies beyond Node.js. The service listens on `127.0.0.1` only and rejects requests sent with any other host name.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/agents` | All agents and counts per status |
| `GET /api/stream` | Server-sent events, pushed on every change |
| `GET /api/slot/N` | One slot as JSON |
| `GET /api/slot/N.svg` | 144×144 key image for slot N |
| `POST /api/slot/N/focus` | Focus the agent in slot N |
| `POST /api/agents/:id/focus` | Focus an agent by session id |
| `POST /api/agents/:id/dismiss` | Remove an agent from the board |
| `POST /api/clear` | Clear agents by status, e.g. `{"statuses":["done"]}` |
| `GET /api/swiftbar` | Menu text in SwiftBar / xbar format |

POST requests must use `Content-Type: application/json`.

## Configuration

Set these in your shell environment:

| Variable | Default | |
|---|---|---|
| `AGENT_STATUS_PORT` | `4317` | Port of the local service |
| `AGENT_STATUS_STALL_MIN` | `3` | Minutes without activity before a working agent counts as sleeping |
| `AGENT_STATUS_MENUBAR` | `1` | Set to `0` to stop `claude-s` from setting up the menu bar |
| `AGENT_STATUS_DIR` | `~/.claude/agent-status` | Where session state is kept between restarts |

## Troubleshooting

- **A session doesn't show up.** Make sure it was started with `claude-s`, then send it a prompt. If it was started from an IDE terminal, check that the folder isn't in `~/Documents`, `~/Desktop` or `~/Downloads` (see Quick start).
- **The menu bar shows `◌`.** The service isn't running. It starts with the next `claude-s`, or run `claude-s restart`.
- **A click doesn't switch windows.** Allow Automation access for `node` (see [Click to jump to the session](#click-to-jump-to-the-session)).
- **Status looks wrong.** `claude-s restart` resets the service. Live sessions reappear after their next event.

## Limitations

- Shows Claude Code sessions on this computer only. Cloud sessions and claude.ai chats don't run local hooks.
- Claude Code has no "retry" event, so **retry** is inferred from repeated tool failures.
- In JetBrains IDEs and VS Code, a click opens the right project window but not a specific terminal tab inside it.
- The menu bar and desktop widget are macOS-only. The dashboard, terminal view and tmux focus also work on Linux.

## Contributing

Issues and pull requests are welcome. Ideas for what's next:

- A native Stream Deck plugin with live key colors
- Precise tab focus for Ghostty, Warp and IDE terminals
- Windows support for click-to-focus
- Desktop notifications when an agent needs input

To test locally, run `bin/claude-s demo` and open http://127.0.0.1:4317. To check the manifests, run `claude plugin validate .`.

## License

[MIT](LICENSE)

---

*Not affiliated with Anthropic. Claude and Claude Code are trademarks of Anthropic.*
