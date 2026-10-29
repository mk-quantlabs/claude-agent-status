// macOS notifications: approval needed, approval still pending, long task finished or failed.
'use strict';
const { execFile } = require('child_process');

const SOUND = 'Glass';

// "45 s", "12 min", "1 h 5 min".
function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}

function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Notification for a task that ended, or null when none is due.
//   outcome: 'done' (Stop) or 'error' (StopFailure)
// A task runs from the prompt (agent.taskStartedAt) until it ends; only tasks at least
// cfg.longTaskMin minutes long are notified.
function taskEndNotice(agent, outcome, now, cfg) {
  if (!cfg.systemNotifications || !cfg.notifyDone || agent.taskStartedAt == null) return null;
  const took = now - agent.taskStartedAt;
  if (took < cfg.longTaskMin * 60e3) return null;
  if (outcome === 'error') {
    return { title: `Stopped with an error · ${agent.project}`, body: clip(`After ${duration(took)}: ${agent.detail || 'request failed'}`, 200) };
  }
  return { title: `Done · ${agent.project}`, body: clip(`Finished after ${duration(took)}${agent.prompt ? `: ${agent.prompt}` : ''}`, 200) };
}

// Reminder for a permission prompt that has been pending for cfg.approvalReminderMin minutes,
// or null. Sent once per approval (agent.approval.reminded). Other dialogs get no reminder.
function reminderNotice(agent, now, cfg) {
  const ap = agent.approval;
  if (!cfg.systemNotifications || !cfg.approvalReminderMin || agent.status !== 'waiting' || !ap || ap.reminded) return null;
  if (ap.type && ap.type !== 'permission_prompt') return null;
  const waited = now - ap.since;
  if (waited < cfg.approvalReminderMin * 60e3) return null;
  return { title: `Still waiting for approval · ${agent.project}`, body: clip(`${ap.detail || 'Needs your input'} · waiting ${duration(waited)}`, 200) };
}

// Shows a notification in Notification Center (and on the lock screen) with osascript.
// Does nothing where osascript isn't available.
function notify({ title, body }, { sound = false } = {}) {
  const script = `on run argv\n  display notification (item 2 of argv) with title (item 1 of argv)${sound ? ` sound name "${SOUND}"` : ''}\nend run`;
  try {
    execFile('osascript', ['-e', script, String(title).slice(0, 120), String(body).slice(0, 200)], { timeout: 5000 }, () => {});
  } catch { /* osascript missing */ }
}

module.exports = { duration, taskEndNotice, reminderNotice, notify };
