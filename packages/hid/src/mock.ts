import { TypedEmitter } from '@codesense/core';
import type {
  ButtonName,
  ConnectionType,
  ControllerState,
  FeedbackFrame,
} from '@codesense/core';
import { emptyControllerState, idleFeedback } from '@codesense/core';
import type { DualSenseEvents, DualSenseLike } from './device.js';

/**
 * A virtual DualSense for development without hardware and for the
 * dashboard's on-screen controller. Input is injected via the sim*
 * methods; feedback frames are captured for inspection/visualization.
 */
export class MockDualSense
  extends TypedEmitter<DualSenseEvents>
  implements DualSenseLike
{
  readonly productName = 'Virtual DualSense';
  readonly connection: ConnectionType = 'usb';
  private state: ControllerState;
  private feedback: FeedbackFrame = idleFeedback();
  private emitTimer: ReturnType<typeof setInterval>;

  constructor() {
    super();
    this.state = emptyControllerState();
    this.state.connected = true;
    this.state.connection = 'usb';
    this.state.battery = { level: 85, charging: true };
    // stream state at ~60 Hz like real hardware would
    this.emitTimer = setInterval(() => {
      this.state.timestamp = Date.now();
      this.emit('input', structuredClone(this.state));
    }, 16);
    this.emitTimer.unref?.();
  }

  setFeedback(frame: FeedbackFrame): void {
    this.feedback = frame;
  }

  getFeedback(): FeedbackFrame {
    return this.feedback;
  }

  close(): void {
    clearInterval(this.emitTimer);
    this.emit('disconnect', { reason: 'closed' });
  }

  // ── simulation surface ─────────────────────────────────────────

  simButton(name: ButtonName, down: boolean): void {
    this.state.buttons[name] = down;
  }

  /** press and release after ms */
  simTap(name: ButtonName, ms = 80): void {
    this.simButton(name, true);
    setTimeout(() => this.simButton(name, false), ms).unref?.();
  }

  simStick(which: 'left' | 'right', x: number, y: number): void {
    this.state.sticks[which] = { x, y };
  }

  simTrigger(which: 'l2' | 'r2', value: number): void {
    this.state.triggers[which] = Math.max(0, Math.min(1, value));
    this.state.buttons[which] = value > 0.5;
  }

  simTouch(active: boolean, x = 960, y = 540): void {
    const p = this.state.touchpad.points[0];
    this.state.touchpad.points[0] = {
      active,
      id: active && !p.active ? (p.id + 1) & 0x7f : p.id,
      x,
      y,
    };
  }

  /** swipe gesture helper: moves touch point over a few frames */
  async simSwipe(direction: 'left' | 'right' | 'up' | 'down'): Promise<void> {
    const from = { x: 960, y: 540 };
    const delta = {
      left: { x: -400, y: 0 },
      right: { x: 400, y: 0 },
      up: { x: 0, y: -300 },
      down: { x: 0, y: 300 },
    }[direction];
    this.simTouch(true, from.x, from.y);
    for (let i = 1; i <= 5; i++) {
      await new Promise((r) => setTimeout(r, 20));
      this.simTouch(true, from.x + (delta.x * i) / 5, from.y + (delta.y * i) / 5);
    }
    await new Promise((r) => setTimeout(r, 20));
    this.simTouch(false, from.x + delta.x, from.y + delta.y);
  }
}
