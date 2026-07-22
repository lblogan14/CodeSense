import { TypedEmitter } from './bus.js';
import type { Profile } from './profile.js';
import type {
  Action,
  AgentStateName,
  ButtonName,
  ControllerState,
  GestureName,
  ModeName,
} from './types.js';
import { BUTTON_NAMES, MODES } from './types.js';

export interface MappingEvents extends Record<string, unknown> {
  action: { action: Action; gesture: string; mode: ModeName };
  gesture: { gesture: string; mode: ModeName };
  mode: { mode: ModeName };
  /** analog approval progress for renderer/dashboard feedback (0..1, or null when idle) */
  approvalPull: { value: number | null };
}

interface ButtonTracker {
  down: boolean;
  downAt: number;
  holdFired: boolean;
  /** consumed by a chord — suppress press/release/hold actions */
  consumed: boolean;
}

type StickDir = 'up' | 'down' | 'left' | 'right';

interface RepeatTracker {
  active: boolean;
  dir: StickDir | null;
  nextFireAt: number;
}

/**
 * The mapping engine: consumes raw ControllerState snapshots, detects
 * gestures (edges, holds, chords, swipes, stick pulses, analog pulls),
 * resolves them against the active profile + mode, and emits Actions.
 *
 * Call `update(state, now)` at the HID polling rate. Call `tick(now)`
 * from a coarse timer (~30 Hz) so holds/repeats fire even when no new
 * HID report arrives.
 */
export class MappingEngine extends TypedEmitter<MappingEvents> {
  private profile: Profile;
  private _mode: ModeName = 'AGENT';
  private buttons = new Map<ButtonName, ButtonTracker>();
  private prev: ControllerState | null = null;
  private lstickRepeat: RepeatTracker = { active: false, dir: null, nextFireAt: 0 };
  private rstickRepeat: RepeatTracker = { active: false, dir: null, nextFireAt: 0 };
  private dpadRepeat = new Map<ButtonName, number>(); // next repeat time
  /** presses deferred because the button participates in a chord */
  private pendingPress = new Map<ButtonName, number>(); // fire-at time
  private touchStart: { x: number; y: number; at: number } | null = null;
  /** how long to wait for a chord to complete before firing a solo press */
  private chordWindowMs = 150;

  /** Injected by the daemon so R2 analog approval only arms during 'permission'. */
  agentState: AgentStateName = 'disconnected';

  // R2 analog approval state
  private approvalArmed = false;
  private approvalPeak = 0;
  /** after a full-pull dispatch, R2 must return to rest before re-arming */
  private approvalCooldown = false;

  constructor(profile: Profile) {
    super();
    this.profile = profile;
    for (const b of BUTTON_NAMES) {
      this.buttons.set(b, { down: false, downAt: 0, holdFired: false, consumed: false });
    }
  }

  get mode(): ModeName {
    return this._mode;
  }

  setMode(mode: ModeName): void {
    if (mode === this._mode) return;
    this._mode = mode;
    this.emit('mode', { mode });
  }

  cycleMode(): void {
    const idx = MODES.indexOf(this._mode);
    this.setMode(MODES[(idx + 1) % MODES.length]!);
  }

  setProfile(profile: Profile): void {
    this.profile = profile;
  }

  getProfile(): Profile {
    return this.profile;
  }

  /** Process a fresh controller state snapshot. */
  update(state: ControllerState, now = Date.now()): void {
    const opts = this.profile.options;

    // ── Buttons: edges, chords ──
    for (const name of BUTTON_NAMES) {
      const tracker = this.buttons.get(name)!;
      const isDown = state.buttons[name];
      if (isDown && !tracker.down) {
        tracker.down = true;
        tracker.downAt = now;
        tracker.holdFired = false;
        tracker.consumed = false;
        // chord check: did this press complete a chord?
        const chord = this.matchChord();
        if (chord) {
          for (const b of chord.buttons) {
            this.buttons.get(b)!.consumed = true;
            this.pendingPress.delete(b);
          }
          this.dispatch(chord.action, `chord:${chord.buttons.join('+')}`);
        } else if (this.isChordParticipant(name)) {
          // hold the solo press briefly — a chord may still complete
          this.pendingPress.set(name, now + this.chordWindowMs);
        } else {
          this.firePress(name, now);
        }
      } else if (!isDown && tracker.down) {
        tracker.down = false;
        this.dpadRepeat.delete(name);
        const pending = this.pendingPress.delete(name);
        if (!tracker.consumed) {
          if (pending) this.firePress(name, now); // quick tap: fire the deferred press
          if (!tracker.holdFired) {
            this.fireGesture(`${name}.release` as GestureName);
          }
        }
        tracker.consumed = false;
      }
    }

    // ── R2 analog approval (highest priority use of R2 while permission pending) ──
    this.updateApproval(state.triggers.r2, opts);

    // ── Sticks → directional repeats ──
    this.updateStickRepeat('lstick', state.sticks.left, this.lstickRepeat, now);
    this.updateStickRepeat('rstick', state.sticks.right, this.rstickRepeat, now);

    // ── Touchpad swipes ──
    const t0 = state.touchpad.points[0];
    if (t0.active && !this.touchStart) {
      this.touchStart = { x: t0.x, y: t0.y, at: now };
    } else if (!t0.active && this.touchStart) {
      const start = this.touchStart;
      this.touchStart = null;
      const wasPrevActive = this.prev?.touchpad.points[0].active ?? false;
      if (wasPrevActive && this.prev) {
        const dx = this.prev.touchpad.points[0].x - start.x;
        const dy = this.prev.touchpad.points[0].y - start.y;
        const th = opts.swipeThreshold;
        if (Math.abs(dx) >= Math.abs(dy)) {
          if (dx <= -th) this.fireGesture('touchpad.swipeLeft');
          else if (dx >= th) this.fireGesture('touchpad.swipeRight');
        } else {
          if (dy <= -th) this.fireGesture('touchpad.swipeUp');
          else if (dy >= th) this.fireGesture('touchpad.swipeDown');
        }
      }
    }

    this.prev = state;
    this.tick(now);
  }

  /** Fire time-based gestures (holds, repeats). Safe to call often. */
  tick(now = Date.now()): void {
    const opts = this.profile.options;

    // deferred chord-participant presses whose window expired
    for (const [name, fireAt] of this.pendingPress) {
      const tracker = this.buttons.get(name)!;
      if (tracker.consumed || !tracker.down) {
        this.pendingPress.delete(name);
        continue;
      }
      if (now >= fireAt) {
        this.pendingPress.delete(name);
        this.firePress(name, now);
      }
    }

    // holds
    for (const name of BUTTON_NAMES) {
      const tracker = this.buttons.get(name)!;
      if (
        tracker.down &&
        !tracker.consumed &&
        !tracker.holdFired &&
        now - tracker.downAt >= opts.holdMs
      ) {
        const gesture = `${name}.hold` as GestureName;
        if (this.hasBinding(gesture)) {
          tracker.holdFired = true;
          this.fireGesture(gesture);
        }
      }
    }

    // dpad repeats
    for (const [name, nextAt] of this.dpadRepeat) {
      const tracker = this.buttons.get(name)!;
      if (!tracker.down || tracker.consumed) {
        this.dpadRepeat.delete(name);
        continue;
      }
      if (now >= nextAt) {
        this.fireGesture(`${name}.press` as GestureName);
        this.dpadRepeat.set(name, now + opts.repeatIntervalMs);
      }
    }

    // stick repeats
    for (const [prefix, rep] of [
      ['lstick', this.lstickRepeat],
      ['rstick', this.rstickRepeat],
    ] as const) {
      if (rep.active && rep.dir && now >= rep.nextFireAt) {
        this.fireGesture(`${prefix}.${rep.dir}` as GestureName);
        rep.nextFireAt = now + this.profile.options.repeatIntervalMs;
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────

  private updateApproval(
    r2: number,
    opts: Profile['options'],
  ): void {
    if (this.agentState !== 'permission') {
      if (this.approvalArmed || this.approvalPeak > 0) {
        this.approvalArmed = false;
        this.approvalPeak = 0;
        this.emit('approvalPull', { value: null });
      }
      return;
    }

    if (r2 > 0.02 || this.approvalArmed) {
      this.emit('approvalPull', { value: r2 });
    }

    if (this.approvalCooldown) {
      if (r2 <= opts.approveRelease) this.approvalCooldown = false;
      return;
    }

    if (!this.approvalArmed) {
      if (r2 >= opts.approveArm) {
        this.approvalArmed = true;
        this.approvalPeak = r2;
      }
      return;
    }

    this.approvalPeak = Math.max(this.approvalPeak, r2);

    if (r2 >= opts.approveFull) {
      // full pull → "always allow" for this tool
      this.approvalArmed = false;
      this.approvalPeak = 0;
      this.approvalCooldown = true;
      this.emit('approvalPull', { value: null });
      this.dispatch({ type: 'approve', scope: 'always' }, 'r2.pull:full');
      return;
    }

    if (r2 <= opts.approveRelease) {
      // feathered pull released → approve once
      this.approvalArmed = false;
      this.approvalPeak = 0;
      this.emit('approvalPull', { value: null });
      this.dispatch({ type: 'approve', scope: 'once' }, 'r2.pull:feather');
    }
  }

  private updateStickRepeat(
    prefix: 'lstick' | 'rstick',
    stick: { x: number; y: number },
    rep: RepeatTracker,
    now: number,
  ): void {
    const dz = this.profile.options.stickDeadzone;
    const mag = Math.hypot(stick.x, stick.y);
    if (mag < dz) {
      rep.active = false;
      rep.dir = null;
      return;
    }
    const dir: StickDir =
      Math.abs(stick.x) > Math.abs(stick.y)
        ? stick.x > 0
          ? 'right'
          : 'left'
        : stick.y > 0
          ? 'down'
          : 'up';
    if (!rep.active || rep.dir !== dir) {
      rep.active = true;
      rep.dir = dir;
      this.fireGesture(`${prefix}.${dir}` as GestureName);
      rep.nextFireAt = now + this.profile.options.repeatDelayMs;
    }
  }

  private firePress(name: ButtonName, now: number): void {
    this.fireGesture(`${name}.press` as GestureName);
    if (name.startsWith('dpad')) {
      this.dpadRepeat.set(name, now + this.profile.options.repeatDelayMs);
    }
  }

  private isChordParticipant(name: ButtonName): boolean {
    return this.profile.chords.some(
      (c) =>
        (c.mode === '*' || c.mode === this._mode) && c.buttons.includes(name),
    );
  }

  private matchChord() {
    const held = BUTTON_NAMES.filter((b) => this.buttons.get(b)!.down);
    for (const chord of this.profile.chords) {
      if (chord.mode !== '*' && chord.mode !== this._mode) continue;
      if (
        chord.buttons.length === held.length &&
        chord.buttons.every((b) => held.includes(b))
      ) {
        return chord;
      }
    }
    return null;
  }

  private hasBinding(gesture: GestureName): boolean {
    return Boolean(this.profile.modes[this._mode]?.bindings[gesture]);
  }

  private fireGesture(gesture: GestureName): void {
    this.emit('gesture', { gesture, mode: this._mode });
    const binding = this.profile.modes[this._mode]?.bindings[gesture];
    if (!binding) return;
    // While a permission is pending, plain R2 press bindings are suppressed —
    // the analog approval tracker owns R2.
    if (this.agentState === 'permission' && gesture.startsWith('r2.')) return;
    this.dispatch(binding.action, gesture);
  }

  private dispatch(action: Action, gesture: string): void {
    if (action.type === 'mode') {
      if (action.mode === 'next') this.cycleMode();
      else this.setMode(action.mode);
      // mode is handled internally but still surfaced for logging
    }
    this.emit('action', { action, gesture, mode: this._mode });
  }
}
