#!/usr/bin/env node
// Command-line control of the running service.
//
//   node ctl.js awake                          prints the keep-awake mode and state
//   node ctl.js awake <always|power|off>       sets the mode
//   node ctl.js notifications                  prints the notification settings
//   node ctl.js notifications <on|off>         turns all notifications on or off
//   node ctl.js notifications done <on|off|MIN>    long-task notifications; MIN sets what counts as long
//   node ctl.js notifications remind <MIN|off>     approval reminder after MIN minutes
//   node ctl.js notifications sound <on|off>       sound with notifications
//   node ctl.js hide-idle [HOURS|off]          shows or sets after how many hours idle sessions are hidden
//   node ctl.js compat                         prints the hook compatibility record as JSON
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

function describeAwake(ka) {
  if (!ka) return 'keep awake: unknown';
  return `keep awake: mode ${ka.mode} · ${ka.active ? '☕ holding' : 'not holding'} (${ka.reason}) · power ${ka.power}`;
}

const mins = (m) => `${Number.isInteger(m) ? m : Number(m.toFixed(2))} min`;

function describeNotifications(c) {
  if (!c.systemNotifications) return ['notifications: off  (turn on: claude-s notifications on)'];
  return [
    'notifications: on',
    '  approval needed:   on',
    `  approval reminder: ${c.approvalReminderMin ? `after ${mins(c.approvalReminderMin)}` : 'off'}`,
    `  long task ended:   ${c.notifyDone ? `on, for tasks of ${mins(c.longTaskMin)} or more` : 'off'}`,
    `  sound:             ${c.notificationSound ? 'on' : 'off'}`,
  ];
}

const USAGE = `usage:
  claude-s notifications                  show the settings
  claude-s notifications on|off           all notifications
  claude-s notifications done on|off      when a long task finishes or stops with an error
  claude-s notifications done MIN         what counts as a long task, in minutes (also turns it on)
  claude-s notifications remind MIN|off   remind about a pending approval after MIN minutes
  claude-s notifications sound on|off     play a sound with notifications`;

// Settings change for `notifications ...` arguments, or null when they aren't valid.
function notificationPatch(args) {
  const [a, b] = args;
  const minutes = (v) => (/^\d+(\.\d+)?$/.test(v || '') ? Number(v) : null);
  if (args.length === 1 && (a === 'on' || a === 'off')) return { systemNotifications: a === 'on' };
  if (args.length === 2 && a === 'done') {
    if (b === 'on' || b === 'off') return { notifyDone: b === 'on' };
    if (minutes(b) !== null) return { notifyDone: true, longTaskMin: minutes(b) };
  }
  if (args.length === 2 && a === 'remind') {
    if (b === 'off') return { approvalReminderMin: 0 };
    if (minutes(b) !== null) return { approvalReminderMin: minutes(b) };
  }
  if (args.length === 2 && a === 'sound' && (b === 'on' || b === 'off')) return { notificationSound: b === 'on' };
  return null;
}

async function main(argv) {
  const [cmd, ...args] = argv;
  if (cmd === 'awake') {
    if (args[0]) {
      const r = await request('POST', '/api/config', { keepAwake: args[0] });
      if (r.status !== 200) { console.error(r.body.error || `HTTP ${r.status}`); return 1; }
    }
    const s = await request('GET', '/api/agents');
    console.log(describeAwake(s.body.keepAwake));
    return 0;
  }
  if (cmd === 'notifications') {
    if (args.length) {
      const patch = notificationPatch(args);
      if (!patch) { console.error(USAGE); return 2; }
      const r = await request('POST', '/api/config', patch);
      if (r.status !== 200) { console.error(r.body.error || `HTTP ${r.status}`); return 1; }
    }
    const c = await request('GET', '/api/config');
    console.log(describeNotifications(c.body).join('\n'));
    return 0;
  }
  if (cmd === 'hide-idle') {
    if (args.length) {
      const v = args[0] === 'off' ? 0 : (/^\d+(\.\d+)?$/.test(args[0]) ? Number(args[0]) : null);
      if (v === null || args.length > 1) { console.error('usage: claude-s hide-idle [HOURS|off]'); return 2; }
      const r = await request('POST', '/api/config', { hideIdleHours: v });
      if (r.status !== 200) { console.error(r.body.error || `HTTP ${r.status}`); return 1; }
    }
    const c = (await request('GET', '/api/config')).body;
    console.log(c.hideIdleHours ? `idle sessions (done or sleeping, no activity for ${c.hideIdleHours} h) are hidden from the menu; the dashboard lists them` : 'idle sessions are never hidden');
    return 0;
  }
  if (cmd === 'compat') {
    const r = await request('GET', '/api/compat');
    console.log(JSON.stringify(r.body));
    return r.status === 200 ? 0 : 1;
  }
  console.error('usage: ctl.js awake [always|power|off] | notifications [...] | hide-idle [HOURS|off] | compat');
  return 2;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(`agent-status service not reachable (${e.message})`);
    process.exit(1);
  });
}

module.exports = { notificationPatch, describeNotifications };
