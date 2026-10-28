// Pending approvals: sessions waiting for a permission decision.
'use strict';
const { execFile } = require('child_process');

// Notification types that mean "a permission decision is needed".
const APPROVAL_TYPES = new Set(['permission_prompt', 'elicitation_dialog']);

// What is being approved: the last tool call summary of the session, else the notification text.
function approvalFor(agent, message, since) {
  return { detail: agent.lastToolDetail || message || 'Needs your input', since };
}

// Agents waiting for approval, oldest first.
function approvalsList(agents) {
  return agents
    .filter((a) => a.status === 'waiting' && a.approval)
    .map((a) => ({ id: a.id, slot: a.slot, project: a.project, detail: a.approval.detail, since: a.approval.since }))
    .sort((x, y) => x.since - y.since);
}

// Title and body of the system notification for an agent that started waiting.
function notificationText(agent) {
  return { title: `Approval needed · ${agent.project}`, body: (agent.approval && agent.approval.detail) || 'Needs your input' };
}

// Shows a macOS notification (Notification Center and lock screen). No-op on other platforms.
function notify({ title, body }) {
  if (process.platform !== 'darwin') return;
  const script = 'on run argv\n  display notification (item 2 of argv) with title (item 1 of argv)\nend run';
  execFile('osascript', ['-e', script, String(title).slice(0, 120), String(body).slice(0, 200)], { timeout: 5000 }, () => {});
}

module.exports = { APPROVAL_TYPES, approvalFor, approvalsList, notificationText, notify };
