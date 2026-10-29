#!/usr/bin/env node
// Minimal stand-in for the Anthropic Messages API on 127.0.0.1, for running the real Claude
// Code CLI in tests without network access.
//   node fake-anthropic-api.js <port> <mode> [command ...]
//   mode "tool":  each prompt that contains "run the command" gets one Bash call, using the
//                 commands given in order (default: echo hello); everything else gets text
//   mode "text":  every request gets a short text reply
//   mode "error": every request gets an invalid_request_error (HTTP 400)
'use strict';
const http = require('http');

const [port, mode = 'text', ...commands] = process.argv.slice(2);
if (!commands.length) commands.push('echo hello');
let n = 0;

// Blocks of the conversation's user messages.
function userBlocks(body) {
  return (body.messages || []).filter((m) => m && m.role === 'user').flatMap((m) => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content || []));
}

// The command for the next Bash call, or null when every request to run one has its result.
function nextCommand(body) {
  const blocks = userBlocks(body);
  const asks = blocks.filter((b) => b && b.type === 'text' && /run the command/.test(b.text || '') && !/^<system-reminder>/.test(b.text || '')).length;
  const results = blocks.filter((b) => b && b.type === 'tool_result').length;
  return results < asks ? commands[Math.min(results, commands.length - 1)] : null;
}

function sse(res, model, block, stopReason) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { id: `msg_${++n}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  if (block.type === 'text') {
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: block.text } });
  } else {
    ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${n}`, name: block.name, input: {} } });
    ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
  }
  ev('content_block_stop', { index: 0 });
  ev('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } });
  ev('message_stop', {});
  res.end();
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) return json(404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } });
    if (req.url.includes('count_tokens')) return json(200, { input_tokens: 10 });
    if (mode === 'error') return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'test error' } });
    let body = {};
    try { body = JSON.parse(raw); } catch { /* empty */ }
    const offersBash = (body.tools || []).some((t) => t && t.name === 'Bash');
    const command = mode === 'tool' && offersBash ? nextCommand(body) : null;
    const block = command
      ? { type: 'tool_use', name: 'Bash', input: { command, description: 'Run a command' } }
      : { type: 'text', text: 'All done.' };
    const stop = block.type === 'tool_use' ? 'tool_use' : 'end_turn';
    if (!body.stream) return json(200, { id: `msg_${++n}`, type: 'message', role: 'assistant', model: body.model, content: [block.type === 'text' ? block : { ...block, id: `toolu_${n}` }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } });
    sse(res, body.model, block, stop);
  });
}).listen(Number(port), '127.0.0.1');
