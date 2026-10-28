#!/usr/bin/env node
// Command-line control of the running service.
//
//   node ctl.js awake                 prints the keep-awake mode and state
//   node ctl.js awake <always|power|off>   sets the mode
//   node ctl.js notifications <on|off>     turns system notifications on or off
'use strict';
const http = require('http');

const PORT = Number(process.env.AGENT_STATUS_PORT) || 4317;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path, method, timeout: 2000,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, body: {} }); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(data);
  });
}

function describe(ka) {
  if (!ka) return 'keep awake: unknown';
  return `keep awake: mode ${ka.mode} · ${ka.active ? '☕ holding' : 'not holding'} (${ka.reason}) · power ${ka.power}`;
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'awake') {
      if (arg) {
        const r = await request('POST', '/api/config', { keepAwake: arg });
        if (r.status !== 200) { console.error(r.body.error || `HTTP ${r.status}`); process.exit(1); }
      }
      const s = await request('GET', '/api/agents');
      console.log(describe(s.body.keepAwake));
      return;
    }
    if (cmd === 'notifications' && (arg === 'on' || arg === 'off')) {
      const r = await request('POST', '/api/config', { systemNotifications: arg === 'on' });
      if (r.status !== 200) { console.error(r.body.error || `HTTP ${r.status}`); process.exit(1); }
      console.log(`system notifications: ${arg}`);
      return;
    }
    console.error('usage: ctl.js awake [always|power|off] | notifications <on|off>');
    process.exit(2);
  } catch (e) {
    console.error(`agent-status service not reachable (${e.message})`);
    process.exit(1);
  }
})();
