#!/usr/bin/env node
// Stand-in for a Claude Code process in tests. Runs hook payloads through report.js as its own
// children (so the service records this process as the session's process) and starts command
// shells the way the Bash tool does (bash -c source .../shell-snapshots/snapshot-...).
//   node fake-claude.js '<steps as JSON>'
//   steps: [["hook", {payload}], ["sleep", ms], ["shell", seconds]]
'use strict';
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPORT = path.join(__dirname, '..', '..', 'plugins', 'agent-status', 'scripts', 'report.js');
const steps = JSON.parse(process.argv[2] || '[]');
const children = [];

(async () => {
  for (const [kind, arg] of steps) {
    if (kind === 'hook') spawnSync(process.execPath, [REPORT], { input: JSON.stringify(arg), stdio: ['pipe', 'ignore', 'ignore'] });
    if (kind === 'sleep') await new Promise((r) => setTimeout(r, arg));
    if (kind === 'shell') children.push(spawn('bash', ['-c', `source /tmp/shell-snapshots/snapshot-bash-0.sh 2>/dev/null || true; sleep ${Number(arg)}; exit 0`], { stdio: 'ignore' }));
  }
  for (const c of children) c.kill();
})();
