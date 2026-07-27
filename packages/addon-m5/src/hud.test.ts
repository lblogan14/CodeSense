import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STATE_HEX, emptyControllerState, idleFeedback } from '@codesense/core';
import type { AgentStateName, DaemonSnapshot, SessionInfo } from '@codesense/core';
import { snapshotToHud } from './hud.js';

function snap(over: Partial<DaemonSnapshot> = {}): DaemonSnapshot {
  return {
    controller: emptyControllerState(),
    feedback: idleFeedback(),
    mode: 'AGENT',
    sessions: [],
    activeSessionSlot: 0,
    agentState: 'idle',
    profileName: 'test',
    backend: 'pty',
    pendingPermission: undefined,
    ...over,
  };
}

test('idle snapshot → calm frame, no permission, no sessions', () => {
  const f = snapshotToHud(snap({ agentState: 'idle' }), { seq: 1 });
  assert.equal(f.state, 'idle');
  assert.equal(f.hex, STATE_HEX.idle);
  assert.equal(f.needsYou, false);
  assert.equal(f.perm, undefined);
  assert.deepEqual(f.sessions, []);
  assert.equal(f.seq, 1);
});

test('every agent state maps to its design-system hex', () => {
  const states: AgentStateName[] = [
    'disconnected', 'idle', 'thinking', 'permission', 'done', 'error',
  ];
  for (const s of states) {
    assert.equal(snapshotToHud(snap({ agentState: s }), { seq: 0 }).hex, STATE_HEX[s]);
  }
});

test('pending permission surfaces the tool + sets needsYou', () => {
  const f = snapshotToHud(
    snap({ agentState: 'permission', pendingPermission: { toolName: 'Bash', detail: 'rm -rf build/' } }),
    { seq: 2 },
  );
  assert.equal(f.needsYou, true);
  assert.deepEqual(f.perm, { tool: 'Bash', detail: 'rm -rf build/' });
});

test('sdk sessions mark active + waiting correctly', () => {
  const sessions: SessionInfo[] = [
    { id: 'a', slot: 1, state: 'thinking', lastEventAt: 0, label: 'web' },
    { id: 'b', slot: 2, state: 'permission', lastEventAt: 0, label: 'api' },
  ];
  const f = snapshotToHud(
    snap({ backend: 'sdk', sessions, activeSessionSlot: 1, agentState: 'thinking' }),
    { seq: 3 },
  );
  assert.equal(f.sessions.length, 2);
  assert.equal(f.sessions[0]!.active, true);
  assert.equal(f.sessions[0]!.waiting, false);
  assert.equal(f.sessions[1]!.active, false);
  assert.equal(f.sessions[1]!.waiting, true); // slot 2 waiting, not active
  assert.equal(f.needsYou, true); // a non-active session needs you
});

test('presets pass through to the frame', () => {
  const f = snapshotToHud(snap(), { seq: 0, presets: [{ id: 'tests', label: 'run tests' }] });
  assert.deepEqual(f.presets, [{ id: 'tests', label: 'run tests' }]);
});
