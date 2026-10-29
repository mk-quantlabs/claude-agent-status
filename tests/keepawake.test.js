// Tests for keep-awake decisions, approvals and settings.
// Run: node tests/keepawake.test.js   (no dependencies)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { shouldKeepAwake, isWorking } = require('../plugins/agent-status/server/keepawake.js');
const { approvalFor, approvalsList, notificationText, APPROVAL_TYPES } = require('../plugins/agent-status/server/approvals.js');
const settings = require('../plugins/agent-status/server/config.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); } catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}
const NOW = 1_000_000;
const GRACE = 60_000;
const working = [{ status: 'in_progress' }, { status: 'done' }];
const idle = [{ status: 'done' }, { status: 'sleeping' }];
const decide = (o) => shouldKeepAwake({ graceMs: GRACE, now: NOW, lastWorkingAt: null, power: 'ac', ...o });

// ---------- keep awake ----------
test('always + working -> hold', () => assert.strictEqual(decide({ agents: working, mode: 'always' }).hold, true));
test('always + working on battery -> hold', () => assert.strictEqual(decide({ agents: working, mode: 'always', power: 'battery' }).hold, true));
test('power + working on AC -> hold', () => assert.strictEqual(decide({ agents: working, mode: 'power' }).hold, true));
test('power + working on battery -> release', () => assert.strictEqual(decide({ agents: working, mode: 'power', power: 'battery' }).hold, false));
test('power + unknown power source (desktop / no pmset) -> hold', () => assert.strictEqual(decide({ agents: working, mode: 'power', power: 'unknown' }).hold, true));
test('off -> never hold', () => assert.strictEqual(decide({ agents: working, mode: 'off' }).hold, false));
test('nobody working, no history -> release', () => assert.strictEqual(decide({ agents: idle, mode: 'always' }).hold, false));
test('inside grace period -> hold', () => {
  const d = decide({ agents: idle, mode: 'always', lastWorkingAt: NOW - 20_000 });
  assert.strictEqual(d.hold, true); assert.match(d.reason, /grace period \(40 s left\)/);
});
test('after grace period -> release', () => assert.strictEqual(decide({ agents: idle, mode: 'always', lastWorkingAt: NOW - 61_000 }).hold, false));
test('waiting for approval alone does not hold', () => assert.strictEqual(decide({ agents: [{ status: 'waiting' }], mode: 'always' }).hold, false));
test('running subagents count as working', () => assert.strictEqual(isWorking({ status: 'done', subagents: 2 }), true));
test('reason names the number of working agents', () => {
  assert.strictEqual(decide({ agents: [...working, { status: 'in_progress' }], mode: 'always' }).reason, '2 agents working');
});

test('grace period starts when work stops, not at the last event', () => {
  const { createKeepAwake } = require('../plugins/agent-status/server/keepawake.js');
  const ka = createKeepAwake({ graceMs: GRACE, dryRun: true });
  ka.update(working, 'always', 0);
  ka.update(working, 'always', 4_000);   // still working at 4 s (no event in between)
  ka.update(idle, 'always', 10_000);     // work seen stopped at 10 s
  assert.strictEqual(ka.update(idle, 'always', 69_000).active, true);
  assert.strictEqual(ka.update(idle, 'always', 71_000).active, false);
});

// ---------- approvals ----------
test('approval types', () => assert.ok(APPROVAL_TYPES.has('permission_prompt') && APPROVAL_TYPES.has('elicitation_dialog') && !APPROVAL_TYPES.has('idle_prompt')));
test('approval detail = last tool call', () => assert.strictEqual(approvalFor({ lastToolDetail: 'Bash: npm run lint' }, 'Claude needs permission', 5).detail, 'Bash: npm run lint'));
test('approval detail falls back to the message', () => assert.strictEqual(approvalFor({}, 'Claude needs permission', 5).detail, 'Claude needs permission'));
test('approvals list: only waiting agents, oldest first', () => {
  const list = approvalsList([
    { id: 'a', slot: 1, project: 'p1', status: 'waiting', approval: { detail: 'x', since: 30 } },
    { id: 'b', slot: 2, project: 'p2', status: 'in_progress', approval: { detail: 'stale', since: 10 } },
    { id: 'c', slot: 3, project: 'p3', status: 'waiting', approval: { detail: 'y', since: 20 } },
  ]);
  assert.deepStrictEqual(list.map((a) => a.id), ['c', 'a']);
});
test('notification text', () => {
  assert.deepStrictEqual(notificationText({ project: 'web-app', approval: { detail: 'Bash: rm -rf build' } }),
    { title: 'Approval needed · web-app', body: 'Bash: rm -rf build' });
});

// ---------- settings ----------
test('defaults: keep awake always, notifications on', () => {
  assert.strictEqual(settings.DEFAULTS.keepAwake, 'always');
  assert.strictEqual(settings.DEFAULTS.systemNotifications, true);
});
test('valid settings accepted', () => assert.deepStrictEqual(settings.validate({ keepAwake: 'power', systemNotifications: false }).value, { keepAwake: 'power', systemNotifications: false }));
test('invalid mode rejected', () => assert.ok(settings.validate({ keepAwake: 'sometimes' }).error));
test('non-boolean notifications rejected', () => assert.ok(settings.validate({ systemNotifications: 'yes' }).error));
test('unknown key rejected', () => assert.ok(settings.validate({ foo: 1 }).error));
test('save + load round trip; invalid saved values ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-status-cfg-'));
  settings.save(dir, { keepAwake: 'off', systemNotifications: false });
  assert.deepStrictEqual(settings.load(dir), { ...settings.DEFAULTS, keepAwake: 'off', systemNotifications: false });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ keepAwake: 'bogus', systemNotifications: false, extra: 1 }));
  assert.deepStrictEqual(settings.load(dir), { ...settings.DEFAULTS, keepAwake: 'always', systemNotifications: false });
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`---- ${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
