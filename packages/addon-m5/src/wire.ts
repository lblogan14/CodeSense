/**
 * The bridge ⇄ device wire types — the single source of truth for the
 * protocol, shared by the TypeScript bridge AND the Moddable TypeScript
 * firmware (`firmware/m5-cores3`).
 *
 * This file is intentionally **dependency-free** (no `@codesense/core`, no Node
 * types) so the firmware can include it directly via its Moddable manifest
 * without pulling in anything host-specific. The literal unions are kept in
 * lockstep with `@codesense/core` by a compile-time check in `protocol.ts`.
 */

export type WireAgentState =
  | 'disconnected'
  | 'idle'
  | 'thinking'
  | 'permission'
  | 'done'
  | 'error';

export type WireMode = 'AGENT' | 'NAV' | 'PROMPT';

export type WireBackend = 'pty' | 'sdk' | 'none';

export interface HudSession {
  /** 1-based slot, mirrors the player-LED slot */
  slot: number;
  state: WireAgentState;
  active: boolean;
  label?: string;
  /** cumulative session cost in USD (sdk backend) */
  costUsd?: number;
  /** waiting on you but not the active slot */
  waiting?: boolean;
}

export interface HudPreset {
  id: string;
  label: string;
}

export interface HudPermission {
  tool?: string;
  detail?: string;
}

/** Down: bridge → device. */
export interface HudFrame {
  t: 'hud';
  state: WireAgentState;
  /** screen tint — STATE_HEX[state] */
  hex: string;
  mode: WireMode;
  /** state === 'permission' or any session waiting on you */
  needsYou: boolean;
  backend: WireBackend;
  /** present while a permission is pending */
  perm?: HudPermission;
  /** [] for pty, up to 4 for sdk */
  sessions: HudSession[];
  presets: HudPreset[];
  /** device-local battery, filled by firmware; absent from the bridge */
  battery?: { level: number; charging?: boolean };
  /** monotonically increasing — lets the device drop stale/duplicate frames */
  seq: number;
}

/** Up: device → bridge. */
export type DeviceEvent =
  | { t: 'hello'; fw?: string; token?: string }
  | { t: 'approve'; scope: 'once' | 'always' }
  | { t: 'reject' }
  | { t: 'mode'; mode: WireMode }
  | { t: 'session'; target: number | 'next' | 'prev' }
  | { t: 'preset'; id: string; text?: string }
  | { t: 'voice'; phase: 'pushStart' | 'pushEnd' }
  | { t: 'send' } // submit the current input (Enter) — e.g. after voice dictation
  | { t: 'palette'; op: 'open' | 'select' | 'confirm' | 'close'; arg?: number | string }
  | { t: 'interrupt' }
  | { t: 'rewind' }
  | { t: 'gesture'; name: 'wake' | 'shake' | 'tilt-up' | 'tilt-down' };
