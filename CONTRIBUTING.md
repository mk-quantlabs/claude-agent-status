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
| `plugins/agent-status/server/focus.js` | Click-to-focus for each terminal / IDE, with a step-by-step trace |
| `plugins/agent-status/server/focus-cli.js` | Runs a click from the calling app (menu bar, `claude-s focus`) |
| `plugins/agent-status/server/keepawake.js` | Keep-awake decision and the `caffeinate` process |
| `plugins/agent-status/server/approvals.js` | Pending approvals and their system notifications |
| `plugins/agent-status/server/config.js` | Settings in `config.json` |
| `plugins/agent-status/server/ctl.js` | Command-line control of the running service (`claude-s awake`, `notifications`) |
| `plugins/agent-status/server/public/index.html` | Web dashboard (single file, no build step) |
| `widgets/` | Menu bar (SwiftBar) and desktop (Übersicht) widgets |
| `bin/claude-s` | Launcher and helper commands |

There are no dependencies and no build step. Please keep it that way unless there's a strong reason.

## Before opening a pull request

```bash
find . -name '*.js' -not -path './node_modules/*' -exec node --check {} \;
node tests/navigation.test.js       # window / tab matching for every supported layout
node tests/keepawake.test.js        # keep-awake decisions, approvals, settings
bash tests/keepawake.integration.sh # keep-awake and approvals against a running service
bash -n bin/claude-s install.sh uninstall.sh
claude plugin validate .            # if you have Claude Code installed
```

- Keep changes focused; one feature or fix per PR.
- If you add support for a new terminal or IDE in `focus.js`, add its window-title style to `tests/navigation.test.js` and mention in the PR which app and OS you tested on.
- Update `README.md` and `CHANGELOG.md` when behaviour changes.

## Reporting bugs

Open an issue with your OS, terminal or IDE, Node version, and the output of `claude-s debug`.
