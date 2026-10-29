# Agent Status (Claude Code plugin)

See all your running Claude Code sessions in one place: which ones need your approval, which are working and which are done.

This folder is the Claude Code plugin. Its hooks report every session's state to a small local service (Node.js 18+, no dependencies, `127.0.0.1:4317` only), which starts by itself with the first session.

With the plugin alone you get:

- the web dashboard at http://127.0.0.1:4317 (or `/agent-status:agents` inside Claude Code)
- the JSON API and live stream (`/api/agents`, `/api/stream`)
- keep-awake while agents work and approval notifications (macOS)

The menu bar icon, the `claude-s` command, the desktop widget and click-to-jump from the menu bar come with the full install:

```bash
git clone https://github.com/mk-quantlabs/claude-agent-status.git ~/claude-agent-status
~/claude-agent-status/install.sh
```

Documentation, screenshots and FAQ: https://github.com/mk-quantlabs/claude-agent-status
