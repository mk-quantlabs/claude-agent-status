// Tests for long-task and reminder notifications, their settings, the notifications command
// arguments and the hook compatibility record.
// Run: node tests/notifications.test.js   (no dependencies)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { duration, taskEndNotice, reminderNotice } = require('../plugins/agent-status/server/notifications.js');
const settings = require('../plugins/agent-status/server/config.js');
const { notificationPatch, describeNotifications } = require('../plugins/agent-status/server/ctl.js');
const { createCompat } = require('../plugins/agent-status/server/compat.js');
const transcript = require('../plugins/agent-status/server/transcript.js');
const { approvalFor, APPROVAL_TYPES } = require('../plugins/agent-status/server/approvals.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); } catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}
const MIN = 60e3;
const NOW = 100 * MIN;
const cfg = (o = {}) => ({ ...settings.DEFAULTS, ...o });
const agent = (o = {}) => ({ project: 'app-3', prompt: 'refactor the parser', detail: 'Done: refactor the parser', ...o });

// ---------- durations ----------
test('duration: seconds, minutes, hours', () => {
  assert.strictEqual(duration(45e3), '45 s');
  assert.strictEqual(duration(24 * MIN), '24 min');
  assert.strictEqual(duration(65 * MIN), '1 h 5 min');
  assert.strictEqual(duration(120 * MIN), '2 h');
});

// ---------- long task finished ----------
test('long task done -> notice with duration and prompt', () => {
  const n = taskEndNotice(agent({ taskStartedAt: NOW - 24 * MIN }), 'done', NOW, cfg());
  assert.deepStrictEqual(n, { title: 'Done · app-3', body: 'Finished after 24 min: refactor the parser' });
});
test('short task -> no notice', () => assert.strictEqual(taskEndNotice(agent({ taskStartedAt: NOW - 4 * MIN }), 'done', NOW, cfg()), null));
test('exactly the threshold -> notice', () => assert.ok(taskEndNotice(agent({ taskStartedAt: NOW - 5 * MIN }), 'done', NOW, cfg())));
test('threshold 0 -> every task', () => assert.ok(taskEndNotice(agent({ taskStartedAt: NOW - 1000 }), 'done', NOW, cfg({ longTaskMin: 0 }))));
test('no task start recorded -> no notice', () => assert.strictEqual(taskEndNotice(agent(), 'done', NOW, cfg({ longTaskMin: 0 })), null));
test('error -> "stopped with an error" with the error text', () => {
  const n = taskEndNotice(agent({ taskStartedAt: NOW - 12 * MIN, detail: 'API error: overloaded' }), 'error', NOW, cfg());
  assert.deepStrictEqual(n, { title: 'Stopped with an error · app-3', body: 'After 12 min: API error: overloaded' });
});
test('notifyDone off -> no notice', () => assert.strictEqual(taskEndNotice(agent({ taskStartedAt: 0 }), 'done', NOW, cfg({ notifyDone: false })), null));
test('all notifications off -> no notice', () => assert.strictEqual(taskEndNotice(agent({ taskStartedAt: 0 }), 'done', NOW, cfg({ systemNotifications: false })), null));
test('long prompt is shortened', () => {
  const n = taskEndNotice(agent({ taskStartedAt: 0, prompt: 'x'.repeat(500) }), 'done', NOW, cfg());
  assert.ok(n.body.length <= 200 && n.body.endsWith('…'));
});

// ---------- approval reminder ----------
const waiting = (o = {}) => agent({ status: 'waiting', approval: { detail: 'Bash: rm -rf build', since: NOW - 6 * MIN }, ...o });
test('approval pending past the reminder time -> reminder', () => {
  assert.deepStrictEqual(reminderNotice(waiting(), NOW, cfg()), { title: 'Still waiting for approval · app-3', body: 'Bash: rm -rf build · waiting 6 min' });
});
test('approval pending shorter -> no reminder', () => assert.strictEqual(reminderNotice(waiting({ approval: { detail: 'x', since: NOW - 2 * MIN } }), NOW, cfg()), null));
test('reminder only once', () => assert.strictEqual(reminderNotice(waiting({ approval: { detail: 'x', since: 0, reminded: true } }), NOW, cfg()), null));
test('reminder off (0) -> none', () => assert.strictEqual(reminderNotice(waiting(), NOW, cfg({ approvalReminderMin: 0 })), null));
test('not waiting -> no reminder', () => assert.strictEqual(reminderNotice(waiting({ status: 'in_progress' }), NOW, cfg()), null));
test('reminder only for permission prompts, not other dialogs', () => {
  assert.ok(reminderNotice(waiting({ approval: { detail: 'x', since: 0, type: 'permission_prompt' } }), NOW, cfg()));
  assert.strictEqual(reminderNotice(waiting({ approval: { detail: 'x', since: 0, type: 'agent_needs_input' } }), NOW, cfg()), null);
});
test('all notifications off -> no reminder', () => assert.strictEqual(reminderNotice(waiting(), NOW, cfg({ systemNotifications: false })), null));

// ---------- settings ----------
test('defaults: done notifications on at 5 min, reminder at 5 min, no sound', () => {
  assert.strictEqual(settings.DEFAULTS.notifyDone, true);
  assert.strictEqual(settings.DEFAULTS.longTaskMin, 5);
  assert.strictEqual(settings.DEFAULTS.approvalReminderMin, 5);
  assert.strictEqual(settings.DEFAULTS.notificationSound, false);
});
test('minutes: 0 to 1440 accepted, decimals accepted', () => {
  assert.deepStrictEqual(settings.validate({ longTaskMin: 0 }).value, { longTaskMin: 0 });
  assert.deepStrictEqual(settings.validate({ approvalReminderMin: 2.5 }).value, { approvalReminderMin: 2.5 });
  assert.deepStrictEqual(settings.validate({ longTaskMin: 1440 }).value, { longTaskMin: 1440 });
});
test('minutes: negative, too large or not a number rejected', () => {
  for (const v of [-1, 1441, '5', null, NaN, Infinity]) assert.ok(settings.validate({ longTaskMin: v }).error, String(v));
});
test('hide idle: default 6 hours; 0 to 720 accepted', () => {
  assert.strictEqual(settings.DEFAULTS.hideIdleHours, 6);
  assert.deepStrictEqual(settings.validate({ hideIdleHours: 0 }).value, { hideIdleHours: 0 });
  assert.deepStrictEqual(settings.validate({ hideIdleHours: 1.5 }).value, { hideIdleHours: 1.5 });
  for (const v of [-1, 721, '6', null]) assert.ok(settings.validate({ hideIdleHours: v }).error, String(v));
});
test('booleans must be booleans', () => {
  assert.ok(settings.validate({ notificationSound: 'yes' }).error);
  assert.deepStrictEqual(settings.validate({ notifyDone: false }).value, { notifyDone: false });
});
test('config file: invalid entries ignored, valid kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cfg-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ longTaskMin: -3, approvalReminderMin: 10, bogus: 1 }));
  const c = settings.load(dir);
  assert.strictEqual(c.longTaskMin, 5);
  assert.strictEqual(c.approvalReminderMin, 10);
  assert.strictEqual(c.bogus, undefined);
});

// ---------- `claude-s notifications` arguments ----------
test('notifications on/off', () => {
  assert.deepStrictEqual(notificationPatch(['off']), { systemNotifications: false });
  assert.deepStrictEqual(notificationPatch(['on']), { systemNotifications: true });
});
test('notifications done on|off|MIN', () => {
  assert.deepStrictEqual(notificationPatch(['done', 'off']), { notifyDone: false });
  assert.deepStrictEqual(notificationPatch(['done', '10']), { notifyDone: true, longTaskMin: 10 });
});
test('notifications remind MIN|off, sound on|off', () => {
  assert.deepStrictEqual(notificationPatch(['remind', 'off']), { approvalReminderMin: 0 });
  assert.deepStrictEqual(notificationPatch(['remind', '3']), { approvalReminderMin: 3 });
  assert.deepStrictEqual(notificationPatch(['sound', 'on']), { notificationSound: true });
});
test('notifications: invalid arguments rejected', () => {
  for (const a of [['maybe'], ['done'], ['done', '-1'], ['remind', 'soon'], ['sound', '1'], ['on', 'off']]) assert.strictEqual(notificationPatch(a), null, a.join(' '));
});
test('settings description', () => {
  const t = describeNotifications(cfg({ longTaskMin: 10, approvalReminderMin: 0 })).join('\n');
  assert.match(t, /approval reminder: off/);
  assert.match(t, /long task ended: {3}on, for tasks of 10 min or more/);
  assert.match(describeNotifications(cfg({ systemNotifications: false }))[0], /^notifications: off/);
});

// ---------- hook compatibility record ----------
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'as-compat-'));
test('compat: known events counted, no problems', () => {
  const c = createCompat(tmp(), { version: '1' });
  c.seen('Stop'); c.seen('Stop'); c.seen('UserPromptSubmit');
  const s = c.snapshot();
  assert.strictEqual(s.events.Stop.count, 2);
  assert.deepStrictEqual(s.problems, []);
});
test('compat: unknown events, missing fields and malformed payloads are problems', () => {
  const c = createCompat(tmp(), { version: '1' });
  c.unknown('PreCompactV2'); c.seen('PreToolUse', ['tool_input']); c.malformed(['hookEventName', 'sessionId']);
  const kinds = c.snapshot().problems.map((p) => p.kind).sort();
  assert.deepStrictEqual(kinds, ['malformed', 'missing', 'unknown']);
});
test('compat: missing fields cleared when a complete event arrives', () => {
  const c = createCompat(tmp(), { version: '1' });
  c.seen('PreToolUse', ['tool_input']); c.seen('PreToolUse', []);
  assert.deepStrictEqual(c.snapshot().problems, []);
});
test('compat: saved and loaded; started over for a new version', () => {
  const dir = tmp();
  const a = createCompat(dir, { version: '1' }); a.unknown('X'); a.save();
  assert.strictEqual(createCompat(dir, { version: '1' }).snapshot().problems.length, 1);
  assert.strictEqual(createCompat(dir, { version: '2' }).snapshot().problems.length, 0);
});

test('compat: any event name is just a key (no prototype)', () => {
  const c = createCompat(tmp(), { version: '1' });
  c.unknown('__proto__'); c.notificationType('constructor'); c.unknown('toString');
  assert.strictEqual(({}).count, undefined);
  assert.strictEqual(c.snapshot().problems.length, 2);
  assert.strictEqual(c.snapshot().notificationTypes.constructor.count, 1);
});

// ---------- transcript (what happened without a hook event) ----------
// Entries shaped like Claude Code's transcript lines.
const T0 = Date.parse('2026-10-29T08:53:13.000Z');
const line = (o) => JSON.stringify(o);
const at = (ms) => new Date(T0 + ms).toISOString();
const writeTranscript = (lines) => { const f = path.join(tmp(), 's.jsonl'); fs.writeFileSync(f, lines.map(line).join('\n') + '\n'); return f; };
const base = [
  { type: 'user', timestamp: at(-1000), message: { role: 'user', content: 'please run the command' } },
  { type: 'assistant', timestamp: at(50), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash' }] } },
];
const rejected = { type: 'user', timestamp: at(12000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: "The user doesn't want to proceed with this tool use.", is_error: true }] } };
const interrupt = { type: 'user', timestamp: at(12001), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } };
test('transcript: nothing after the prompt -> still pending', () => {
  assert.deepStrictEqual(transcript.after(writeTranscript(base), T0, 'toolu_1'), { answered: false, interrupted: false });
});
test('transcript: Esc on a permission prompt -> answered and interrupted', () => {
  assert.deepStrictEqual(transcript.after(writeTranscript([...base, rejected, interrupt]), T0, 'toolu_1'), { answered: true, interrupted: true });
});
test('transcript: result of another tool call is not an answer', () => {
  assert.strictEqual(transcript.after(writeTranscript([...base, rejected]), T0, 'toolu_2').answered, false);
});
test('transcript: entries before `since` ignored', () => {
  assert.strictEqual(transcript.after(writeTranscript([...base, interrupt]), T0 + 20000, 'toolu_1').interrupted, false);
});
test('transcript: a prompt that merely mentions the marker is not an interrupt', () => {
  const f = writeTranscript([...base, { type: 'user', timestamp: at(5000), message: { role: 'user', content: 'why does it say [Request interrupted by user] here?' } }]);
  assert.strictEqual(transcript.after(f, T0, null).interrupted, false);
});
test('transcript: missing file, bad path, broken lines -> nothing', () => {
  assert.deepStrictEqual(transcript.after('/nonexistent/x.jsonl', 0, 'a'), { answered: false, interrupted: false });
  assert.deepStrictEqual(transcript.after('relative.jsonl', 0, 'a'), { answered: false, interrupted: false });
  const f = path.join(tmp(), 'b.jsonl'); fs.writeFileSync(f, '{not json\n' + line(interrupt) + '\n{"type":"user"');
  assert.strictEqual(transcript.after(f, T0, null).interrupted, true);
});
test('transcript: only the end of a large file is read', () => {
  const f = path.join(tmp(), 'big.jsonl');
  fs.writeFileSync(f, line(interrupt) + '\n' + line({ type: 'assistant', timestamp: at(1), message: { content: 'x'.repeat(200 * 1024) } }) + '\n');
  assert.strictEqual(transcript.after(f, T0, null).interrupted, false);
});

// ---------- what a session waits for ----------
test('input types that block the session', () => {
  for (const t of ['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']) assert.ok(APPROVAL_TYPES.has(t), t);
  for (const t of ['idle_prompt', 'auth_success', 'agent_completed']) assert.ok(!APPROVAL_TYPES.has(t), t);
});
test('permission prompt shows the tool call; other dialogs show their message', () => {
  const a = { lastToolDetail: 'Bash: curl example.com' };
  assert.strictEqual(approvalFor(a, 'Claude needs your permission', 1, 'permission_prompt').detail, 'Bash: curl example.com');
  assert.strictEqual(approvalFor(a, 'A notice to acknowledge', 1, 'agent_needs_input').detail, 'A notice to acknowledge');
});

console.log(`---- ${passed} passed`);
