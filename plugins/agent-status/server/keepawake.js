// Keep awake: prevents idle system sleep with `caffeinate -i -w <service pid>` while agents work.
// The display may still sleep and the screen may still lock.
'use strict';
const { spawn, execFileSync } = require('child_process');

const MODES = ['always', 'power', 'off'];

// An agent counts as working while it is in progress or has running subagents.
function isWorking(a) {
  return a.status === 'in_progress' || (a.subagents || 0) > 0;
}

// Whether idle sleep must be prevented, and why.
//   agents:        current agents
//   mode:          'always' | 'power' (only on AC power) | 'off'
//   power:         'ac' | 'battery' | 'unknown'
//   lastWorkingAt: last time any agent was working (ms), or null
//   graceMs:       how long the hold lasts after the last agent stopped working
function shouldKeepAwake({ agents, mode, power, now, lastWorkingAt, graceMs }) {
  if (mode === 'off') return { hold: false, reason: 'mode: off' };
  if (mode === 'power' && power === 'battery') return { hold: false, reason: 'on battery (mode: power)' };
  const working = agents.filter(isWorking).length;
  if (working > 0) return { hold: true, reason: `${working} agent${working > 1 ? 's' : ''} working` };
  if (lastWorkingAt && now - lastWorkingAt < graceMs) {
    return { hold: true, reason: `grace period (${Math.ceil((graceMs - (now - lastWorkingAt)) / 1000)} s left)` };
  }
  return { hold: false, reason: 'no agent working' };
}

// Power source from `pmset -g ps`: 'ac', 'battery' or 'unknown' (no pmset, or unreadable).
function readPower() {
  try {
    const out = execFileSync('pmset', ['-g', 'ps'], { encoding: 'utf8', timeout: 1500 });
    if (/Battery Power/.test(out)) return 'battery';
    if (/AC Power/.test(out)) return 'ac';
  } catch { /* pmset not available */ }
  return 'unknown';
}

// Holds or releases the sleep assertion according to shouldKeepAwake().
// dryRun: computes the state without starting caffeinate (demo mode).
function createKeepAwake({ graceMs = 60e3, powerTtlMs = 15e3, dryRun = false } = {}) {
  let child = null;
  let since = null;
  let lastWorkingAt = null;
  let wasWorking = false;
  let available = true;
  let power = 'unknown';
  let powerAt = 0;
  let state = { mode: 'off', active: false, since: null, power, reason: 'not started' };

  function currentPower(now) {
    if (now - powerAt >= powerTtlMs) { power = readPower(); powerAt = now; }
    return power;
  }

  function start(now) {
    since = now;
    if (dryRun) { child = { dryRun: true }; return; }
    try {
      const c = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
      c.on('error', () => { available = false; if (child === c) child = null; });
      c.on('exit', () => { if (child === c) child = null; });
      child = c;
    } catch { available = false; child = null; }
  }

  function stop() {
    if (child && !child.dryRun) { try { child.kill('SIGTERM'); } catch { /* already exited */ } }
    child = null;
    since = null;
  }

  function update(agents, mode, now = Date.now()) {
    // lastWorkingAt: now while agents work, and the moment work stopped once they don't.
    const workingNow = agents.some(isWorking);
    if (workingNow || wasWorking) lastWorkingAt = now;
    wasWorking = workingNow;
    const p = currentPower(now);
    const d = shouldKeepAwake({ agents, mode, power: p, now, lastWorkingAt, graceMs });
    if (d.hold && !child && available) start(now);
    if (!d.hold && child) stop();
    const active = !!child;
    state = {
      mode, active, since: active ? since : null, power: p,
      reason: d.hold && !active ? 'caffeinate not available' : d.reason,
    };
    return state;
  }

  return { update, stop, state: () => state, pid: () => (child && child.pid) || null };
}

module.exports = { MODES, isWorking, shouldKeepAwake, readPower, createKeepAwake };
