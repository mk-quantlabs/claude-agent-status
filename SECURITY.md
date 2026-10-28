# Security Policy

## How it is built

- The local service listens on `127.0.0.1` only and rejects requests whose `Host` header isn't localhost (DNS-rebinding protection).
- State-changing requests require `Content-Type: application/json`, so web pages can't send them without a CORS preflight, which the service never approves.
- Click-to-focus runs commands via `execFile` (no shell) and validates every value first.
- Hooks send only what the board needs: session id, folder, event type, tool name and a short summary.

## Reporting a vulnerability

Please **don't** open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/mk-quantlabs/claude-agent-status/security/advisories/new) instead.
You can expect a first reply within a few days.
