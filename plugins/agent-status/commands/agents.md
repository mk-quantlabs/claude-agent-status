---
description: Open the live agent status dashboard
allowed-tools: Bash(node:*), Bash(open:*), Bash(xdg-open:*), Bash(curl:*)
---
Make sure the agent-status daemon is running, then open its dashboard:

1. Check `curl -s --max-time 1 http://127.0.0.1:4317/health`. If it fails, start it in the background with
   `nohup node "${CLAUDE_PLUGIN_ROOT}/server/server.js" >/dev/null 2>&1 &` and wait a second.
2. Open `http://127.0.0.1:4317/` with `open` on macOS or `xdg-open` on Linux.

Reply with one short line saying the dashboard is open. Do not explain anything else.
