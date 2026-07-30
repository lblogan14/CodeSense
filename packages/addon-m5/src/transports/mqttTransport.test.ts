import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mqttTopics } from './mqttTransport.js';

test('mqttTopics derives hud + event topics from a prefix', () => {
  assert.deepEqual(mqttTopics('codesense/m5'), {
    hud: 'codesense/m5/hud',
    event: 'codesense/m5/event',
  });
});

test('mqttTopics tolerates a trailing slash', () => {
  assert.deepEqual(mqttTopics('codesense/m5/'), {
    hud: 'codesense/m5/hud',
    event: 'codesense/m5/event',
  });
});

test('mqttTopics supports a per-device prefix', () => {
  assert.deepEqual(mqttTopics('home/desk/orb1'), {
    hud: 'home/desk/orb1/hud',
    event: 'home/desk/orb1/event',
  });
});
