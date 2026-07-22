/**
 * Core shared types for CodeSense.
 */

// ─── Controller input model ─────────────────────────────────────

export type ButtonName =
  | 'cross'
  | 'circle'
  | 'square'
  | 'triangle'
  | 'dpadUp'
  | 'dpadDown'
  | 'dpadLeft'
  | 'dpadRight'
  | 'l1'
  | 'r1'
  | 'l2'
  | 'r2'
  | 'l3'
  | 'r3'
  | 'create'
  | 'options'
  | 'ps'
  | 'touchpad'
  | 'mute';

export const BUTTON_NAMES: readonly ButtonName[] = [
  'cross',
  'circle',
  'square',
  'triangle',
  'dpadUp',
  'dpadDown',
  'dpadLeft',
  'dpadRight',
  'l1',
  'r1',
  'l2',
  'r2',
  'l3',
  'r3',
  'create',
  'options',
  'ps',
  'touchpad',
  'mute',
] as const;

export interface StickState {
  /** -1..1, right positive */
  x: number;
  /** -1..1, down positive (raw HID orientation) */
  y: number;
}

export interface TouchPoint {
  active: boolean;
  id: number;
  /** 0..1919 */
  x: number;
  /** 0..1079 */
  y: number;
}

export type ConnectionType = 'usb' | 'bluetooth' | 'none';

export interface ControllerState {
  connected: boolean;
  connection: ConnectionType;
  buttons: Record<ButtonName, boolean>;
  sticks: { left: StickState; right: StickState };
  /** analog trigger positions, 0..1 */
  triggers: { l2: number; r2: number };
  touchpad: { points: [TouchPoint, TouchPoint] };
  battery: { level: number; charging: boolean };
  /** ms timestamp of the report */
  timestamp: number;
}

export function emptyControllerState(): ControllerState {
  const buttons = Object.fromEntries(BUTTON_NAMES.map((b) => [b, false])) as Record<
    ButtonName,
    boolean
  >;
  return {
    connected: false,
    connection: 'none',
    buttons,
    sticks: { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } },
    triggers: { l2: 0, r2: 0 },
    touchpad: {
      points: [
        { active: false, id: 0, x: 0, y: 0 },
        { active: false, id: 0, x: 0, y: 0 },
      ],
    },
    battery: { level: 0, charging: false },
    timestamp: 0,
  };
}

// ─── Controller feedback (output) model ─────────────────────────

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type TriggerEffect =
  | { mode: 'off' }
  /** Constant resistance across a zone. start/strength are 0..1 */
  | { mode: 'resistance'; start: number; strength: number }
  /** Section resistance: firm wall between start and end */
  | { mode: 'section'; start: number; end: number; strength: number }
  /** Vibration when pulled past start */
  | { mode: 'vibration'; start: number; amplitude: number; frequency: number };

export interface FeedbackFrame {
  lightbar: RGB;
  /** bitmask of 5 player LEDs (bit 0 = leftmost) */
  playerLeds: number;
  muteLed: boolean;
  /** 0..1 each */
  rumble: { low: number; high: number };
  triggers: { l2: TriggerEffect; r2: TriggerEffect };
}

export function idleFeedback(): FeedbackFrame {
  return {
    lightbar: { r: 0, g: 0, b: 0 },
    playerLeds: 0,
    muteLed: false,
    rumble: { low: 0, high: 0 },
    triggers: { l2: { mode: 'off' }, r2: { mode: 'off' } },
  };
}

// ─── Agent state model ───────────────────────────────────────────

export type AgentStateName =
  | 'disconnected'
  | 'idle'
  | 'thinking'
  | 'permission'
  | 'done'
  | 'error';

/** Normalized event ingested from Claude Code hooks or the Agent SDK. */
export interface AgentEvent {
  kind:
    | 'session-start'
    | 'session-end'
    | 'prompt-submit'
    | 'pre-tool'
    | 'post-tool'
    | 'tool-failure'
    | 'permission-request'
    | 'permission-resolved'
    | 'stop'
    | 'stop-failure'
    | 'notification'
    | 'compact'
    | 'subagent-start'
    | 'subagent-end';
  sessionId?: string;
  toolName?: string;
  detail?: string;
  timestamp: number;
}

export interface SessionInfo {
  id: string;
  /** 1-based slot shown on player LEDs (1..4) */
  slot: number;
  cwd?: string;
  state: AgentStateName;
  lastEventAt: number;
  label?: string;
}

// ─── Modes & actions ─────────────────────────────────────────────

export type ModeName = 'AGENT' | 'NAV' | 'PROMPT';
export const MODES: readonly ModeName[] = ['AGENT', 'NAV', 'PROMPT'] as const;

/** Dispatched by the mapping engine, consumed by a backend. */
export type Action =
  | { type: 'keys'; keys: string } // raw bytes to the pty (escape sequences ok)
  | { type: 'text'; text: string } // literal text typed
  | { type: 'slash'; command: string } // "/compact" — sent with Enter
  | { type: 'mode'; mode: ModeName | 'next' }
  | { type: 'session'; target: 'next' | 'prev' | number }
  | { type: 'approve'; scope: 'once' | 'always' }
  | { type: 'reject' }
  | { type: 'interrupt' }
  | { type: 'dial'; direction: 'up' | 'down' } // reasoning/model dial
  | { type: 'palette'; palette: string } // open a named palette
  | { type: 'macro'; id: string }
  | { type: 'voice'; action: 'toggle' | 'push' | 'pushStart' | 'pushEnd' }
  | { type: 'rewind' } // open the checkpoint menu (Esc Esc)
  | { type: 'replay-status' }
  | { type: 'noop' };

/** Gestures the mapping engine can bind, beyond plain button presses. */
export type GestureName =
  | `${ButtonName}.press`
  | `${ButtonName}.release`
  | `${ButtonName}.hold` // fired after holdMs
  | 'touchpad.swipeLeft'
  | 'touchpad.swipeRight'
  | 'touchpad.swipeUp'
  | 'touchpad.swipeDown'
  | 'lstick.up'
  | 'lstick.down'
  | 'lstick.left'
  | 'lstick.right'
  | 'rstick.up'
  | 'rstick.down'
  | 'rstick.left'
  | 'rstick.right'
  | 'r2.pull' // analog approval pull (state machine handles depth)
  | 'l2.pull';

// ─── Daemon-level events (for dashboard / logging) ───────────────

export interface DaemonSnapshot {
  controller: ControllerState;
  feedback: FeedbackFrame;
  mode: ModeName;
  sessions: SessionInfo[];
  activeSessionSlot: number;
  agentState: AgentStateName;
  profileName: string;
  backend: 'pty' | 'sdk' | 'none';
  pendingPermission?: { toolName?: string; detail?: string } | undefined;
}
