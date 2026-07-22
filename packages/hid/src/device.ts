import HID from 'node-hid';
import { TypedEmitter } from '@codesense/core';
import type { ConnectionType, ControllerState, FeedbackFrame } from '@codesense/core';
import { idleFeedback } from '@codesense/core';
import {
  BT_OUTPUT_LEN,
  DUALSENSE_EDGE_PID,
  DUALSENSE_PID,
  SONY_VID,
  buildBtOutputReport,
  buildUsbOutputReport,
  parseInputReport,
} from './protocol.js';

export interface DualSenseEvents extends Record<string, unknown> {
  input: ControllerState;
  disconnect: { reason: string };
  error: { message: string };
}

/** Common surface shared by the real device and the mock. */
export interface DualSenseLike extends TypedEmitter<DualSenseEvents> {
  readonly connection: ConnectionType;
  readonly productName: string;
  setFeedback(frame: FeedbackFrame): void;
  close(): void;
}

export interface DeviceCandidate {
  path: string;
  product: string;
  pid: number;
  guessedConnection: ConnectionType;
}

/** Enumerate DualSense gamepad collections currently attached. */
export function findDualSenseDevices(): DeviceCandidate[] {
  return HID.devices()
    .filter(
      (d) =>
        d.vendorId === SONY_VID &&
        (d.productId === DUALSENSE_PID || d.productId === DUALSENSE_EDGE_PID) &&
        (d.usagePage === undefined || d.usagePage === 0x01) &&
        (d.usage === undefined || d.usage === 0x05) &&
        d.path,
    )
    .map((d) => ({
      path: d.path!,
      product: d.product ?? 'DualSense',
      pid: d.productId,
      guessedConnection: d.path!.toLowerCase().includes('mi_03')
        ? ('usb' as const)
        : ('bluetooth' as const),
    }));
}

const WRITE_INTERVAL_MS = 33; // ~30 Hz max output rate, on-change only
const INIT_WRITES = 3; // repeat init flags on the first few writes

/**
 * A connected physical DualSense. Parses input reports into
 * ControllerState and renders FeedbackFrames to the hardware.
 * Connection type (USB vs BT) is confirmed from the first input report.
 */
export class HidDualSense extends TypedEmitter<DualSenseEvents> implements DualSenseLike {
  private device: HID.HID;
  private _connection: ConnectionType;
  private desired: FeedbackFrame = idleFeedback();
  private lastWrittenJson = '';
  private writeTimer: ReturnType<typeof setInterval>;
  private btSeq = 0;
  private initRemaining = INIT_WRITES;
  private requestedFullMode = false;
  private closed = false;
  readonly productName: string;

  constructor(candidate: DeviceCandidate) {
    super();
    this.productName = candidate.product;
    this._connection = candidate.guessedConnection;
    this.device = new HID.HID(candidate.path);
    this.device.on('data', (buf: Buffer) => this.onData(buf));
    this.device.on('error', (err: Error) => {
      this.emit('error', { message: String(err) });
      this.dispose('device error');
    });
    this.writeTimer = setInterval(() => this.flush(), WRITE_INTERVAL_MS);
    this.writeTimer.unref?.();
  }

  get connection(): ConnectionType {
    return this._connection;
  }

  setFeedback(frame: FeedbackFrame): void {
    this.desired = frame;
  }

  close(): void {
    this.dispose('closed');
  }

  private onData(buf: Buffer): void {
    if (buf.length === 0) return;
    // BT simplified 0x01 report (~10 bytes): request calibration feature
    // report 0x05 once — that switches the controller to full 0x31 mode.
    if (buf[0] === 0x01 && buf.length < 20) {
      this._connection = 'bluetooth';
      if (!this.requestedFullMode) {
        this.requestedFullMode = true;
        try {
          this.device.getFeatureReport(0x05, 41);
        } catch (err) {
          this.emit('error', { message: `BT full-mode switch failed: ${String(err)}` });
        }
      }
      return;
    }
    const state = parseInputReport(buf);
    if (!state) return;
    this._connection = state.connection;
    this.emit('input', state);
  }

  private flush(): void {
    if (this.closed) return;
    const json = JSON.stringify(this.desired);
    const init = this.initRemaining > 0;
    if (json === this.lastWrittenJson && !init) return;
    try {
      const report =
        this._connection === 'bluetooth'
          ? buildBtOutputReport(this.desired, this.btSeq++, { init })
          : buildUsbOutputReport(this.desired, { init });
      this.device.write(Array.from(report));
      this.lastWrittenJson = json;
      if (init) this.initRemaining -= 1;
    } catch (err) {
      this.emit('error', { message: `output write failed: ${String(err)}` });
      this.dispose('write failure');
    }
  }

  private dispose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.writeTimer);
    try {
      // best effort: return the controller to a quiet state
      const off = buildUsbOutputReport(idleFeedback());
      if (this._connection === 'usb') this.device.write(Array.from(off));
      else this.device.write(Array.from(buildBtOutputReport(idleFeedback(), this.btSeq++)));
    } catch {
      // device likely gone
    }
    try {
      this.device.close();
    } catch {
      // ignore
    }
    this.emit('disconnect', { reason });
  }
}

export interface DeviceManagerEvents extends Record<string, unknown> {
  attach: { device: DualSenseLike };
  detach: { reason: string };
  error: { message: string };
}

/**
 * Watches for a DualSense to appear (hotplug polling) and manages the
 * lifecycle of the active device.
 */
export class DeviceManager extends TypedEmitter<DeviceManagerEvents> {
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private active: HidDualSense | null = null;
  private warnedBt = false;

  constructor(private opts: { allowBluetooth?: boolean } = {}) {
    super();
  }

  get device(): DualSenseLike | null {
    return this.active;
  }

  start(scanIntervalMs = 2000): void {
    this.scan();
    this.scanTimer = setInterval(() => this.scan(), scanIntervalMs);
    this.scanTimer.unref?.();
  }

  stop(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = null;
    this.active?.close();
    this.active = null;
  }

  private scan(): void {
    if (this.active) return;
    let candidates: DeviceCandidate[];
    try {
      candidates = findDualSenseDevices();
    } catch (err) {
      this.emit('error', { message: `HID enumeration failed: ${String(err)}` });
      return;
    }
    if (candidates.length === 0) return;
    // prefer USB when both transports are present
    let pick = candidates.find((c) => c.guessedConnection === 'usb');
    if (!pick) {
      if (!this.opts.allowBluetooth) {
        if (!this.warnedBt) {
          this.warnedBt = true;
          this.emit('error', {
            message:
              'DualSense found on Bluetooth only — plug in USB, or start with --experimental-bt',
          });
        }
        return;
      }
      pick = candidates[0]!;
    }
    try {
      const device = new HidDualSense(pick);
      device.on('disconnect', ({ reason }) => {
        if (this.active === device) this.active = null;
        this.emit('detach', { reason });
      });
      this.active = device;
      this.emit('attach', { device });
    } catch (err) {
      this.emit('error', {
        message: `failed to open ${pick.product}: ${String(err)} (is Steam Input or DS4Windows holding it?)`,
      });
    }
  }
}

export { BT_OUTPUT_LEN };
