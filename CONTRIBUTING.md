# Contributing

Thanks for helping out! Bug reports, ideas and pull requests are all welcome.

## Run it locally

You need Node.js 18+ and (for the full flow) Claude Code.

```bash
git clone https://github.com/mk-quantlabs/claude-agent-status.git
cd claude-agent-status
bin/claude-s demo          # fake agents on http://127.0.0.1:4317
```

To try your changes with real sessions without installing anything:

```bash
bin/claude-s               # starts Claude with the plugin from this folder
```

## Project layout

| Path | What it is |
|---|---|
| `plugins/agent-status/hooks/hooks.json` | Which Claude Code events are reported |
| `plugins/agent-status/scripts/report.js` | The hook: reads the event, posts it to the local service |
| `plugins/agent-status/server/server.js` | Local service: status logic, API, live stream |
| `plugins/agent-status/server/focus.js` | Click-to-focus for each terminal / IDE |
| `plugins/agent-status/server/public/index.html` | Web dashboard (single file, no build step) |
| `widgets/` | Menu bar (SwiftBar) and desktop (Übersicht) widgets |
| `bin/claude-s` | Launcher and helper commands |

There are no dependencies and no build step. Please keep it that way unless there's a strong reason.

## Before opening a pull request

```bash
find . -name '*.js' -not -path './node_modules/*' -exec node --check {} \;
bash -n bin/claude-s install.sh uninstall.sh
claude plugin validate .            # if you have Claude Code installed
```

- Keep changes focused; one feature or fix per PR.
- If you add support for a new terminal or IDE in `focus.js`, mention in the PR which app and OS you tested on.
- Update `README.md` and `CHANGELOG.md` when behaviour changes.

## Reporting bugs

Open an issue with your OS, terminal or IDE, Node version, and the output of `claude-s status` and `curl -s http://127.0.0.1:4317/health`.
