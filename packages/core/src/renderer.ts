import type {
  AgentStateName,
  FeedbackFrame,
  RGB,
  TriggerEffect,
} from './types.js';
import { idleFeedback } from './types.js';

/**
 * Lightbar colors per agent state (additive LED RGB, from the CodeSense
 * design system — these differ from the screen hex values because LEDs
 * are additive light).
 */
export const STATE_LIGHTBAR: Record<AgentStateName, RGB> = {
  disconnected: { r: 0, g: 0, b: 0 },
  idle: { r: 0, g: 112, b: 255 }, // Sense Blue — solid, calm
  thinking: { r: 120, g: 40, b: 255 }, // purple — slow breathe
  permission: { r: 255, g: 140, b: 0 }, // amber — double pulse, needs you
  done: { r: 0, g: 255, b: 96 }, // green — gentle fades then idle
  error: { r: 255, g: 0, b: 32 }, // red — sharp flashes then solid
};

/** Screen-space hex per state (dashboard + CLI share this). */
export const STATE_HEX: Record<AgentStateName, string> = {
  disconnected: '#5C6470',
  idle: '#3E9BFF',
  thinking: '#9D7CFF',
  permission: '#FFB020',
  done: '#2FD48A',
  error: '#FF5C5C',
};

interface HapticPulse {
  at: number; // ms offset from state entry
  duration: number;
  low: number; // 0..1
  high: number;
}

/** Haptic patterns per state entry (from the design brief). */
const HAPTIC_PATTERNS: Partial<Record<AgentStateName, HapticPulse[]>> = {
  permission: [
    { at: 0, duration: 90, low: 0.7, high: 0.5 },
    { at: 180, duration: 90, low: 0.7, high: 0.5 },
  ],
  done: [{ at: 0, duration: 140, low: 0.3, high: 0.15 }],
  error: [{ at: 0, duration: 260, low: 1, high: 0.9 }],
};

export interface RendererOptions {
  /** overall lightbar brightness 0..1 */
  brightness?: number;
  /** disable rumble entirely */
  haptics?: boolean;
  /** disable adaptive trigger effects */
  adaptiveTriggers?: boolean;
}

/**
 * Pure, time-driven feedback renderer: agent state + wall clock in,
 * FeedbackFrame out. The daemon calls `frame(now)` at the output tick
 * rate (~30 Hz) and writes the result to the HID layer.
 */
export class FeedbackRenderer {
  private state: AgentStateName = 'disconnected';
  private stateEnteredAt = 0;
  private playerLeds = 0;
  private muteLed = false;
  private approvalPull: number | null = null;
  private replayRequestedAt: number | null = null;
  private transientPulses: { until: number; low: number; high: number }[] = [];
  private opts: Required<RendererOptions>;

  constructor(opts: RendererOptions = {}) {
    this.opts = {
      brightness: opts.brightness ?? 1,
      haptics: opts.haptics ?? true,
      adaptiveTriggers: opts.adaptiveTriggers ?? true,
    };
  }

  setState(state: AgentStateName, now = Date.now()): void {
    if (state === this.state) return;
    this.state = state;
    this.stateEnteredAt = now;
  }

  getState(): AgentStateName {
    return this.state;
  }

  setPlayerLeds(mask: number): void {
    this.playerLeds = mask & 0b11111;
  }

  setMuteLed(on: boolean): void {
    this.muteLed = on;
  }

  /** live analog approval pull (0..1) or null; drives amber intensity */
  setApprovalPull(value: number | null): void {
    this.approvalPull = value;
  }

  /** R3 "read status to me": replays the state-entry haptic + a bright flash */
  replayStatus(now = Date.now()): void {
    this.replayRequestedAt = now;
  }

  setOptions(opts: RendererOptions): void {
    this.opts = { ...this.opts, ...opts };
  }

  /** One-off haptic pulse (palette tick, mode change, etc.). */
  pulse(low = 0.35, high = 0.2, durationMs = 45, now = Date.now()): void {
    this.transientPulses.push({ until: now + durationMs, low, high });
  }

  frame(now = Date.now()): FeedbackFrame {
    const f = idleFeedback();
    const t = (now - this.stateEnteredAt) / 1000; // seconds in state
    const base = STATE_LIGHTBAR[this.state];

    // ── Lightbar intensity envelope per state ──
    let intensity: number;
    switch (this.state) {
      case 'disconnected':
        intensity = 0;
        break;
      case 'idle':
        intensity = 0.35; // calm, low brightness
        break;
      case 'thinking':
        // slow breathe: 2.4 s sine, 40%..100%
        intensity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((t / 2.4) * Math.PI * 2 - Math.PI / 2));
        break;
      case 'permission': {
        // double pulse every 2 s: two 150 ms peaks at 0 ms and 300 ms
        const phase = (t % 2) * 1000;
        const pulse =
          (phase < 150 ? 1 : 0) || (phase >= 300 && phase < 450 ? 1 : 0);
        intensity = pulse ? 1 : 0.45;
        // pulling R2 brightens the bar with the pull — physical dialog
        if (this.approvalPull != null) {
          intensity = Math.max(intensity, 0.45 + 0.55 * this.approvalPull);
        }
        break;
      }
      case 'done': {
        // 3 gentle fades over ~2.4 s, then hold soft until decay to idle
        if (t < 2.4) {
          intensity = 0.35 + 0.65 * Math.abs(Math.sin((t / 0.8) * Math.PI));
        } else {
          intensity = 0.5;
        }
        break;
      }
      case 'error': {
        // two sharp 120 ms flashes then solid
        if (t < 0.6) {
          const phase = (t * 1000) % 300;
          intensity = phase < 120 ? 1 : 0.1;
        } else {
          intensity = 0.85;
        }
        break;
      }
    }

    // R3 replay: 400 ms full-bright flash
    if (this.replayRequestedAt != null && now - this.replayRequestedAt < 400) {
      intensity = 1;
    }

    const k = intensity * this.opts.brightness;
    f.lightbar = {
      r: Math.round(base.r * k),
      g: Math.round(base.g * k),
      b: Math.round(base.b * k),
    };

    // ── Haptics ──
    if (this.opts.haptics) {
      const pattern = HAPTIC_PATTERNS[this.state];
      if (pattern) {
        const ms = now - this.stateEnteredAt;
        for (const p of pattern) {
          if (ms >= p.at && ms < p.at + p.duration) {
            f.rumble = { low: Math.max(f.rumble.low, p.low), high: Math.max(f.rumble.high, p.high) };
          }
        }
      }
      // replay-status: re-run the current state's pattern relative to the request
      if (this.replayRequestedAt != null) {
        const ms = now - this.replayRequestedAt;
        const pattern2 = HAPTIC_PATTERNS[this.state] ?? [
          { at: 0, duration: 100, low: 0.4, high: 0.2 },
        ];
        let anyActive = false;
        for (const p of pattern2) {
          if (ms >= p.at && ms < p.at + p.duration) {
            f.rumble = { low: Math.max(f.rumble.low, p.low), high: Math.max(f.rumble.high, p.high) };
            anyActive = true;
          }
        }
        const patternEnd = Math.max(...pattern2.map((p) => p.at + p.duration), 400);
        if (!anyActive && ms > patternEnd) this.replayRequestedAt = null;
      }
    }

    // transient pulses (palette ticks etc.)
    if (this.opts.haptics && this.transientPulses.length) {
      this.transientPulses = this.transientPulses.filter((p) => p.until > now);
      for (const p of this.transientPulses) {
        f.rumble = {
          low: Math.max(f.rumble.low, p.low),
          high: Math.max(f.rumble.high, p.high),
        };
      }
    }

    // ── Adaptive triggers ──
    if (this.opts.adaptiveTriggers && this.state === 'permission') {
      // weighted "confirm" resistance on R2 — approval is a deliberate act
      const r2: TriggerEffect = { mode: 'resistance', start: 0.15, strength: 0.65 };
      f.triggers.r2 = r2;
    }

    f.playerLeds = this.playerLeds;
    f.muteLed = this.muteLed;
    return f;
  }
}
