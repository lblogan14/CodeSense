/**
 * An in-process fake orb: connects to a device transport over ws, records the
 * HudFrames it receives, and can emit DeviceEvents. Used by tests and for
 * validating the loop headlessly, with no browser and no hardware.
 */
import { WebSocket } from 'ws';
import type { DeviceEvent, HudFrame } from './protocol.js';

export interface MockDeviceOptions {
  url: string;
  token?: string;
  onFrame?: (frame: HudFrame) => void;
}

export class MockDevice {
  private ws: WebSocket | null = null;
  readonly frames: HudFrame[] = [];

  constructor(private opts: MockDeviceOptions) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      this.ws = ws;
      ws.on('open', () => {
        if (this.opts.token) this.send({ t: 'hello', token: this.opts.token });
        resolve();
      });
      ws.on('message', (raw) => {
        try {
          const frame = JSON.parse((raw as Buffer).toString('utf8')) as HudFrame;
          if (frame && frame.t === 'hud') {
            this.frames.push(frame);
            this.opts.onFrame?.(frame);
          }
        } catch {
          /* ignore non-frame traffic */
        }
      });
      ws.on('error', reject);
    });
  }

  send(ev: DeviceEvent): void {
    this.ws?.send(JSON.stringify(ev));
  }

  get last(): HudFrame | undefined {
    return this.frames[this.frames.length - 1];
  }

  close(): void {
    this.ws?.close();
  }
}
