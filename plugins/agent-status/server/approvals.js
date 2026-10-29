// Pending approvals: sessions waiting for a permission decision.
'use strict';

// Notification types that mean the session is blocked until the user answers: a permission
// prompt, an MCP elicitation form or link, or another dialog that needs input.
const APPROVAL_TYPES = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);

// What is being asked: for a permission prompt the last tool call of the session, otherwise
// the notification text.
function approvalFor(agent, message, since, type) {
  const detail = type === 'permission_prompt' || !type ? agent.lastToolDetail || message : message || agent.lastToolDetail;
  return type ? { detail: detail || 'Needs your input', since, type } : { detail: detail || 'Needs your input', since };
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

module.exports = { APPROVAL_TYPES, approvalFor, approvalsList, notificationText };
