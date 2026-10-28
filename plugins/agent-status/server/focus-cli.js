#!/usr/bin/env node
// Brings an agent's window to the front from the calling process (SwiftBar menu click,
// `claude-s focus`), records the attempt and prints the steps taken.
//
//   node focus-cli.js <session-id | slot> [source]
'use strict';
const http = require('http');
const { focus, logAttempt } = require('./focus');

const PORT = Number(process.env.AGENT_STATUS_PORT) || 4317;
const key = String(process.argv[2] || '');
const via = process.argv[3] || 'cli';

if (!/^[\w-]{1,80}$/.test(key)) {
  console.error('usage: focus-cli.js <session-id | slot>');
  process.exit(2);
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path, timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(body)) : reject(new Error(`HTTP ${res.statusCode}`))));
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

(async () => {
  let agent;
  try {
    agent = await get(/^\d+$/.test(key) ? `/api/slot/${key}/raw` : `/api/agents/${key}`);
  } catch (e) {
    console.error(`agent-status: no agent "${key}" (${e.message})`);
    process.exit(1);
  }
  const result = await focus(agent);
  logAttempt(agent, result, via);
  console.log(`${result.ok ? '✓' : '✗'} ${agent.project}: ${result.method}`);
  for (const t of result.trace) {
    console.log(`   ${t.ok ? '✓' : '✗'} ${t.step}${t.out ? ` → ${t.out}` : ''}${t.error ? `  [${t.error}]` : ''}`);
  }
  process.exit(result.ok ? 0 : 1);
})();
