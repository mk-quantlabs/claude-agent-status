// Reads the end of a Claude Code session transcript (JSON lines on disk) to tell what happened
// after a given moment when Claude Code sends no hook event for it, such as a request the user
// interrupted with Esc or a permission prompt dismissed without an answer.
'use strict';
const fs = require('fs');

const TAIL_BYTES = 128 * 1024;
const INTERRUPTED = '[Request interrupted by user';

// Whether a path can be a transcript: an absolute path to a .jsonl file.
function isTranscriptPath(p) {
  return typeof p === 'string' && p.startsWith('/') && p.endsWith('.jsonl') && !p.includes('\0');
}

// Whether a transcript entry is Claude Code's interrupt marker (a text that starts with it).
function isInterrupt(e) {
  const c = e.message && e.message.content;
  if (typeof c === 'string') return c.startsWith(INTERRUPTED);
  return Array.isArray(c) && c.some((b) => b && b.type === 'text' && typeof b.text === 'string' && b.text.startsWith(INTERRUPTED));
}

// What the transcript shows after `since` (ms):
//   answered:    a result for the tool call `toolUseId` was written (its permission prompt was
//                answered)
//   interrupted: the user interrupted the request
// Both false when the file can't be read.
function after(file, since, toolUseId) {
  const out = { answered: false, interrupted: false };
  if (!isTranscriptPath(file)) return out;
  let text;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1); // first line may be cut off
    } finally { fs.closeSync(fd); }
  } catch { return out; }
  for (const line of text.split('\n')) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || e.type !== 'user' || !(Date.parse(e.timestamp) > since)) continue;
    const c = e.message && e.message.content;
    if (toolUseId && Array.isArray(c) && c.some((b) => b && b.type === 'tool_result' && b.tool_use_id === toolUseId)) out.answered = true;
    if (isInterrupt(e)) out.interrupted = true;
  }
  return out;
}

module.exports = { after, isTranscriptPath };
