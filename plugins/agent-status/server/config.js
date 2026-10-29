// Service settings stored in <state dir>/config.json.
'use strict';
const fs = require('fs');
const path = require('path');
const { MODES } = require('./keepawake');

// keepAwake:           'always' | 'power' | 'off'
// systemNotifications: all macOS notifications on or off
// notifyDone:          notify when a long task finishes or stops with an error
// longTaskMin:         minimum task length, in minutes, for that notification
// approvalReminderMin: minutes after which a pending approval is notified once more (0: never)
// notificationSound:   play a sound with notifications
// hideIdleHours:       sessions done or sleeping with no activity for this many hours are left
//                      out of the menu and other compact views (0: never)
const DEFAULTS = {
  keepAwake: 'always',
  systemNotifications: true,
  notifyDone: true,
  longTaskMin: 5,
  approvalReminderMin: 5,
  notificationSound: false,
  hideIdleHours: 6,
};

const BOOLEANS = ['systemNotifications', 'notifyDone', 'notificationSound'];
const MINUTES = ['longTaskMin', 'approvalReminderMin'];
const MAX_MIN = 24 * 60;
const MAX_HOURS = 30 * 24;

// Validates a partial settings object. Returns { value } with the accepted keys, or { error }.
function validate(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'expected a JSON object' };
  const value = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'keepAwake') {
      if (!MODES.includes(v)) return { error: `keepAwake must be one of: ${MODES.join(', ')}` };
      value.keepAwake = v;
    } else if (BOOLEANS.includes(k)) {
      if (typeof v !== 'boolean') return { error: `${k} must be true or false` };
      value[k] = v;
    } else if (MINUTES.includes(k)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_MIN) return { error: `${k} must be a number of minutes from 0 to ${MAX_MIN}` };
      value[k] = v;
    } else if (k === 'hideIdleHours') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_HOURS) return { error: `hideIdleHours must be a number of hours from 0 to ${MAX_HOURS}` };
      value.hideIdleHours = v;
    } else {
      return { error: `unknown setting: ${k}` };
    }
  }
  return { value };
}

// Settings from config.json merged over the defaults; invalid or unknown entries are skipped.
function load(dir) {
  const cfg = { ...DEFAULTS };
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    for (const [k, v] of Object.entries(saved || {})) {
      const r = validate({ [k]: v });
      if (r.value) Object.assign(cfg, r.value);
    }
  } catch { /* no config file */ }
  return cfg;
}

function save(dir, cfg) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json.tmp'), JSON.stringify(cfg, null, 2) + '\n');
  fs.renameSync(path.join(dir, 'config.json.tmp'), path.join(dir, 'config.json'));
}

module.exports = { DEFAULTS, validate, load, save };
