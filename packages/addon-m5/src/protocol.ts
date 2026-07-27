/**
 * The daemon-side half of the protocol: it re-exports the shared wire types
 * (see {@link ./wire.ts}) and adds the mapping onto the daemon's existing ws
 * `ClientMessage` vocabulary.
 *
 * The wire types live in `wire.ts` (dependency-free, shared with the firmware);
 * everything here may use `@codesense/core`. A compile-time check keeps the
 * shared unions in lockstep with core's own `AgentStateName` / `ModeName`.
 */
import type { Action, AgentStateName, ModeName } from '@codesense/core';
import type { DeviceEvent, WireAgentState, WireMode } from './wire.js';

export * from './wire.js';

// ── compile-time: the shared wire unions must equal core's ──────
// If core adds/removes a state or mode, one of these stops being assignable to
// `true` and the build fails here — a loud reminder to update wire.ts.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _stateInSync: Exact<AgentStateName, WireAgentState> = true;
const _modeInSync: Exact<ModeName, WireMode> = true;
void _stateInSync;
void _modeInSync;

/**
 * The subset of the daemon's ws `ClientMessage` vocabulary the bridge sends.
 * Declared structurally so the addon depends only on `@codesense/core` types,
 * never on `@codesense/cli`.
 */
export type DaemonOutMessage =
  | { type: 'action'; action: Action }
  | { type: 'set-mode'; mode: ModeName }
  | { type: 'prompt'; text: string; slot?: number }
  | { type: 'palette-select'; index: number }
  | { type: 'palette-confirm' }
  | { type: 'palette-close' };

/** Parse a raw device message, returning null if it isn't a well-formed event. */
export function parseDeviceEvent(raw: string | Buffer): DeviceEvent | null {
  let obj: unknown;
  try {
    obj = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const t = (obj as { t?: unknown }).t;
  if (typeof t !== 'string') return null;
  return obj as DeviceEvent;
}

/**
 * Translate a device event into the daemon ws message that realizes it.
 * Returns null for events the bridge handles itself (hello/auth) or that carry
 * no daemon-side effect (a bare gesture — the bridge assigns its semantics
 * first and re-issues a concrete event).
 */
export function deviceEventToClientMessage(ev: DeviceEvent): DaemonOutMessage | null {
  switch (ev.t) {
    case 'approve':
      return { type: 'action', action: { type: 'approve', scope: ev.scope } };
    case 'reject':
      return { type: 'action', action: { type: 'reject' } };
    case 'mode':
      return { type: 'set-mode', mode: ev.mode };
    case 'session':
      return { type: 'action', action: { type: 'session', target: ev.target } };
    case 'preset':
      // The bridge resolves the preset's text before mapping; a bare id with no
      // text has nothing to send.
      return ev.text ? { type: 'prompt', text: ev.text } : null;
    case 'voice':
      return { type: 'action', action: { type: 'voice', action: ev.phase } };
    case 'interrupt':
      return { type: 'action', action: { type: 'interrupt' } };
    case 'rewind':
      return { type: 'action', action: { type: 'rewind' } };
    case 'palette':
      switch (ev.op) {
        case 'open':
          return { type: 'action', action: { type: 'palette', palette: String(ev.arg ?? '') } };
        case 'select':
          return { type: 'palette-select', index: Number(ev.arg ?? 0) };
        case 'confirm':
          return { type: 'palette-confirm' };
        case 'close':
          return { type: 'palette-close' };
      }
      return null;
    case 'hello':
    case 'gesture':
      return null;
  }
}
