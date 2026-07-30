import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deviceEventToClientMessage, parseDeviceEvent } from './protocol.js';

test('approve maps to an approve action carrying the scope', () => {
  assert.deepEqual(deviceEventToClientMessage({ t: 'approve', scope: 'once' }), {
    type: 'action',
    action: { type: 'approve', scope: 'once' },
  });
  assert.deepEqual(deviceEventToClientMessage({ t: 'approve', scope: 'always' }), {
    type: 'action',
    action: { type: 'approve', scope: 'always' },
  });
});

test('reject / interrupt / rewind map to their actions', () => {
  assert.deepEqual(deviceEventToClientMessage({ t: 'reject' }), {
    type: 'action',
    action: { type: 'reject' },
  });
  assert.deepEqual(deviceEventToClientMessage({ t: 'interrupt' }), {
    type: 'action',
    action: { type: 'interrupt' },
  });
  assert.deepEqual(deviceEventToClientMessage({ t: 'rewind' }), {
    type: 'action',
    action: { type: 'rewind' },
  });
});

test('mode maps to set-mode', () => {
  assert.deepEqual(deviceEventToClientMessage({ t: 'mode', mode: 'NAV' }), {
    type: 'set-mode',
    mode: 'NAV',
  });
});

test('session maps to a session action, preserving the target', () => {
  assert.deepEqual(deviceEventToClientMessage({ t: 'session', target: 2 }), {
    type: 'action',
    action: { type: 'session', target: 2 },
  });
  assert.deepEqual(deviceEventToClientMessage({ t: 'session', target: 'next' }), {
    type: 'action',
    action: { type: 'session', target: 'next' },
  });
});

test('voice push maps to a voice action', () => {
  assert.deepEqual(deviceEventToClientMessage({ t: 'voice', phase: 'pushStart' }), {
    type: 'action',
    action: { type: 'voice', action: 'pushStart' },
  });
});

test('send maps to an Enter keystroke (submit the input)', () => {
  assert.deepEqual(deviceEventToClientMessage({ t: 'send' }), {
    type: 'action',
    action: { type: 'keys', keys: '\r' },
  });
});

test('preset with text becomes a prompt; without text it is null', () => {
  assert.deepEqual(deviceEventToClientMessage({ t: 'preset', id: 'tests', text: 'run the tests' }), {
    type: 'prompt',
    text: 'run the tests',
  });
  assert.equal(deviceEventToClientMessage({ t: 'preset', id: 'tests' }), null);
});

test('palette ops map to their client messages', () => {
  assert.deepEqual(deviceEventToClientMessage({ t: 'palette', op: 'open', arg: 'quick' }), {
    type: 'action',
    action: { type: 'palette', palette: 'quick' },
  });
  assert.deepEqual(deviceEventToClientMessage({ t: 'palette', op: 'select', arg: 3 }), {
    type: 'palette-select',
    index: 3,
  });
  assert.deepEqual(deviceEventToClientMessage({ t: 'palette', op: 'confirm' }), {
    type: 'palette-confirm',
  });
  assert.deepEqual(deviceEventToClientMessage({ t: 'palette', op: 'close' }), {
    type: 'palette-close',
  });
});

test('hello has no daemon-side effect; gestures map by name', () => {
  assert.equal(deviceEventToClientMessage({ t: 'hello', token: 'x' }), null);
  // shake = dismiss/stop → interrupt; wake/tilt have no daemon effect yet
  assert.deepEqual(deviceEventToClientMessage({ t: 'gesture', name: 'shake' }), {
    type: 'action',
    action: { type: 'interrupt' },
  });
  assert.equal(deviceEventToClientMessage({ t: 'gesture', name: 'wake' }), null);
});

test('parseDeviceEvent rejects malformed input', () => {
  assert.equal(parseDeviceEvent('not json'), null);
  assert.equal(parseDeviceEvent('123'), null);
  assert.equal(parseDeviceEvent('{"nope":1}'), null);
  assert.deepEqual(parseDeviceEvent('{"t":"reject"}'), { t: 'reject' });
});
