// Service settings stored in <state dir>/config.json.
'use strict';
const fs = require('fs');
const path = require('path');
const { MODES } = require('./keepawake');

const DEFAULTS = { keepAwake: 'always', systemNotifications: true };

// Validates a partial settings object. Returns { value } with the accepted keys, or { error }.
function validate(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'expected a JSON object' };
  const value = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'keepAwake') {
      if (!MODES.includes(v)) return { error: `keepAwake must be one of: ${MODES.join(', ')}` };
      value.keepAwake = v;
    } else if (k === 'systemNotifications') {
      if (typeof v !== 'boolean') return { error: 'systemNotifications must be true or false' };
      value.systemNotifications = v;
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
