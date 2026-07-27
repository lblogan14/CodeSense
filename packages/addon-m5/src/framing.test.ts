import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LineDecoder, encodeLine } from './framing.js';

test('encodeLine appends a single newline', () => {
  assert.equal(encodeLine({ t: 'reject' }), '{"t":"reject"}\n');
});

test('decoder reassembles a message split across chunks', () => {
  const d = new LineDecoder();
  assert.deepEqual(d.push('{"t":"re'), []);
  assert.deepEqual(d.push('ject"}\n'), ['{"t":"reject"}']);
});

test('decoder splits multiple messages in one chunk', () => {
  const d = new LineDecoder();
  assert.deepEqual(d.push('{"a":1}\n{"b":2}\n'), ['{"a":1}', '{"b":2}']);
});

test('decoder tolerates CRLF and blank lines', () => {
  const d = new LineDecoder();
  assert.deepEqual(d.push('{"a":1}\r\n\r\n{"b":2}\r\n'), ['{"a":1}', '{"b":2}']);
});

test('decoder holds a trailing partial until completed', () => {
  const d = new LineDecoder();
  assert.deepEqual(d.push('{"a":1}\n{"b":'), ['{"a":1}']);
  assert.deepEqual(d.push('2}\n'), ['{"b":2}']);
});

test('reset drops a buffered partial', () => {
  const d = new LineDecoder();
  d.push('{"partial":');
  d.reset();
  assert.deepEqual(d.push('{"a":1}\n'), ['{"a":1}']);
});
