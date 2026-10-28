// Demo mode (`node server.js --demo`): simulated agents that change status every few seconds.
'use strict';
const PROJECTS = [
  ['app-1', 'Add pagination to the list endpoint'],
  ['app-2', 'Fix the flaky date-parsing test'],
  ['app-3', 'Refactor the settings page into tabs'],
  ['app-4', 'Backfill last month of records'],
  ['app-5', 'Write the v2 migration guide'],
  ['app-6', 'Bump Node version in CI'],
];
const BRANCH_TOOLS = [
  'Bash: npm test', 'Edit: src/routes/list.ts', 'Read: README.md', 'Grep: parseDate',
  'Bash: pytest -q', 'Write: docs/migration.md',
];

function start(apply, broadcast) {
  const ids = PROJECTS.map((_, i) => `demo-${i + 1}`);
  const emit = (i, event, extra = {}) => {
    apply({ event, session_id: ids[i], cwd: `/home/dev/code/${PROJECTS[i][0]}`, ts: Date.now(), ...extra });
  };
  PROJECTS.forEach((p, i) => {
    emit(i, 'SessionStart', { source: 'startup', loc: { termProgram: 'iTerm.app', bundleId: 'com.googlecode.iterm2' } });
    emit(i, 'UserPromptSubmit', { prompt: p[1] });
  });
  // Initial status of each simulated agent.
  emit(0, 'PreToolUse', { tool: 'Bash', detail: 'Bash: npm test -- list' });
  emit(1, 'PostToolUseFailure', { tool: 'Bash', error: 'AssertionError: expected 2024-01-31' });
  emit(1, 'PostToolUseFailure', { tool: 'Bash', error: 'AssertionError: expected 2024-01-31' });
  emit(2, 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  emit(3, 'SubagentStart'); emit(3, 'SubagentStart'); emit(3, 'PreToolUse', { tool: 'Task', detail: 'Task: backfill week 3' });
  emit(4, 'Stop');
  emit(5, 'Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });

  if (process.env.AGENT_STATUS_DEMO_STATIC) { broadcast(); return; } // static demo: no further changes
  setInterval(() => {
    const i = Math.floor(Math.random() * ids.length);
    const r = Math.random();
    if (r < 0.45) emit(i, 'PreToolUse', { tool: 'Bash', detail: BRANCH_TOOLS[Math.floor(Math.random() * BRANCH_TOOLS.length)] });
    else if (r < 0.6) emit(i, 'PostToolUse', { tool: 'Bash' });
    else if (r < 0.7) emit(i, 'Stop');
    else if (r < 0.78) emit(i, 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Edit' });
    else if (r < 0.86) { emit(i, 'PostToolUseFailure', { tool: 'Bash', error: 'exit code 1' }); emit(i, 'PostToolUseFailure', { tool: 'Bash', error: 'exit code 1' }); }
    else emit(i, 'UserPromptSubmit', { prompt: PROJECTS[i][1] });
    broadcast();
  }, 3500).unref();
  broadcast();
}

module.exports = { start };
