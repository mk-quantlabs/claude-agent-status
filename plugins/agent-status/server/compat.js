// Hook compatibility record: which Claude Code hook events arrived, and anything in them this
// version doesn't understand (unknown event names, missing fields, payloads without a session
// or event name). Kept in <state dir>/compat.json and started over when the Agent Status
// version changes; shown by `claude-s doctor`.
'use strict';
const fs = require('fs');
const path = require('path');

function empty(now, version) {
  return { version, since: now, events: null, unknown: null, missing: null, malformed: null, notificationTypes: null };
}

function createCompat(dir, { persist = true, version = null } = {}) {
  const file = path.join(dir, 'compat.json');
  let data = null;
  if (persist) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
  }
  if (!data || typeof data !== 'object' || typeof data.events !== 'object' || data.version !== version) data = empty(Date.now(), version);
  // Name-keyed maps have no prototype, so any event name is just a key.
  for (const k of ['events', 'unknown', 'missing', 'notificationTypes']) data[k] = Object.assign(Object.create(null), data[k]);

  const bump = (map, key, now) => {
    const e = map[key] || (map[key] = { count: 0, lastAt: 0 });
    e.count += 1; e.lastAt = now;
  };

  return {
    // A known event; missing: names of expected payload fields that were absent.
    seen(event, missing, now = Date.now()) {
      bump(data.events, event, now);
      if (Array.isArray(missing) && missing.length) {
        data.missing[event] = { fields: missing.slice(0, 10).map(String), lastAt: now };
      } else {
        delete data.missing[event];
      }
    },
    // The notification_type of a Notification event.
    notificationType(type, now = Date.now()) {
      bump(data.notificationTypes, String(type || '(none)').slice(0, 60), now);
    },
    // An event name this version doesn't handle.
    unknown(event, now = Date.now()) {
      bump(data.unknown, String(event || '(none)').slice(0, 60), now);
    },
    // A payload without a session id or event name; keys: its top-level field names.
    malformed(keys, now = Date.now()) {
      const m = data.malformed || { count: 0 };
      data.malformed = { count: m.count + 1, lastAt: now, keys: (Array.isArray(keys) ? keys : []).slice(0, 15).map(String) };
    },
    // Problems found: [{ kind, text }].
    problems() {
      const out = [];
      for (const [name, e] of Object.entries(data.unknown)) out.push({ kind: 'unknown', text: `unknown hook event "${name}" (${e.count}×)` });
      for (const [name, m] of Object.entries(data.missing)) out.push({ kind: 'missing', text: `${name} events arrive without: ${m.fields.join(', ')}` });
      if (data.malformed) out.push({ kind: 'malformed', text: `${data.malformed.count} hook payload(s) without a session id or event name (fields: ${data.malformed.keys.join(', ') || 'none'})` });
      return out;
    },
    snapshot() { return { ...data, problems: this.problems() }; },
    reset(now = Date.now()) {
      data = empty(now, version);
      for (const k of ['events', 'unknown', 'missing', 'notificationTypes']) data[k] = Object.create(null);
    },
    save() {
      if (!persist) return;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file + '.tmp', JSON.stringify(data));
        fs.renameSync(file + '.tmp', file);
      } catch { /* not writable */ }
    },
  };
}

module.exports = { createCompat };
