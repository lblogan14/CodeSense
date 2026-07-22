/** Wire types mirrored from @codesense/core (kept dependency-free). */

export type AgentStateName =
  | 'disconnected'
  | 'idle'
  | 'thinking'
  | 'permission'
  | 'done'
  | 'error';

export type ModeName = 'AGENT' | 'NAV' | 'PROMPT';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ControllerState {
  connected: boolean;
  connection: 'usb' | 'bluetooth' | 'none';
  buttons: Record<string, boolean>;
  sticks: { left: { x: number; y: number }; right: { x: number; y: number } };
  triggers: { l2: number; r2: number };
  touchpad: { points: { active: boolean; id: number; x: number; y: number }[] };
  battery: { level: number; charging: boolean };
  timestamp: number;
}

export interface FeedbackFrame {
  lightbar: RGB;
  playerLeds: number;
  muteLed: boolean;
  rumble: { low: number; high: number };
  triggers: { l2: { mode: string }; r2: { mode: string } };
}

export interface SessionInfo {
  id: string;
  slot: number;
  cwd?: string;
  state: AgentStateName;
  lastEventAt: number;
  label?: string;
}

export interface DaemonSnapshot {
  controller: ControllerState;
  feedback: FeedbackFrame;
  mode: ModeName;
  sessions: SessionInfo[];
  activeSessionSlot: number;
  agentState: AgentStateName;
  profileName: string;
  backend: 'pty' | 'sdk' | 'none';
  pendingPermission?: { toolName?: string; detail?: string };
}

export interface PaletteState {
  open: boolean;
  name: string;
  entries: { label: string }[];
  selected: number;
}

export const STATE_HEX: Record<AgentStateName, string> = {
  disconnected: '#5C6470',
  idle: '#3E9BFF',
  thinking: '#9D7CFF',
  permission: '#FFB020',
  done: '#2FD48A',
  error: '#FF5C5C',
};

export const STATE_LABEL: Record<AgentStateName, string> = {
  disconnected: 'disconnected',
  idle: 'idle',
  thinking: 'thinking',
  permission: 'waiting for you',
  done: 'done',
  error: 'error',
};

export const STATE_ICON: Record<AgentStateName, string> = {
  disconnected: '○',
  idle: '●',
  thinking: '◐',
  permission: '▲',
  done: '✓',
  error: '✕',
};
