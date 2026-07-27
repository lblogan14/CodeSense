/**
 * USB-CDC serial device transport (P2) — the docked / offline path. On the
 * CoreS3 the native USB gives power + data on one cable, so this is the most
 * reliable link when the orb sits on the desk.
 *
 * `serialport` is a native module and is loaded lazily (via a computed import
 * specifier) so `@codesense/addon-m5` builds and its tests run without it. It's
 * only required when a serial transport is actually started:
 *
 *   pnpm --filter @codesense/addon-m5 add serialport
 *   # and add "serialport" to onlyBuiltDependencies in pnpm-workspace.yaml
 */
import { Transport } from './transport.js';
import { parseDeviceEvent } from '../protocol.js';
import { LineDecoder, encodeLine } from '../framing.js';
import type { HudFrame } from '../wire.js';

/** The slice of the serialport API we use — kept local so no types are needed. */
interface SerialPortLike {
  isOpen: boolean;
  write(data: string): void;
  close(cb?: () => void): void;
  on(event: 'data', fn: (chunk: Buffer) => void): void;
  on(event: 'open' | 'close', fn: () => void): void;
  on(event: 'error', fn: (err: Error) => void): void;
}

export interface SerialTransportOptions {
  path: string;
  baudRate?: number;
  /** if set, the device must send `{t:'hello', token}` before being admitted */
  token?: string;
  log?: (line: string) => void;
}

export class SerialTransport extends Transport {
  readonly name = 'serial';
  private port: SerialPortLike | null = null;
  private readonly decoder = new LineDecoder();
  private authed = false;
  private lastFrame: HudFrame | null = null;

  constructor(private opts: SerialTransportOptions) {
    super();
  }

  get deviceCount(): number {
    return this.port?.isOpen && this.authed ? 1 : 0;
  }

  async start(): Promise<void> {
    let SerialPortCtor: new (o: { path: string; baudRate: number }) => SerialPortLike;
    try {
      const spec = 'serialport';
      const mod = (await import(spec)) as { SerialPort: typeof SerialPortCtor };
      SerialPortCtor = mod.SerialPort;
    } catch {
      throw new Error(
        "serial transport needs the 'serialport' package — run: pnpm --filter @codesense/addon-m5 add serialport",
      );
    }

    const baudRate = this.opts.baudRate ?? 115200;
    const port = new SerialPortCtor({ path: this.opts.path, baudRate });
    this.port = port;
    this.authed = !this.opts.token;

    port.on('open', () => {
      this.log(`open ${this.opts.path} @ ${baudRate}`);
      if (this.authed) this.admit();
    });
    port.on('data', (chunk) => this.onData(chunk));
    port.on('close', () => {
      this.log('closed');
      if (this.authed) this.emit('disconnect', { deviceId: this.opts.path });
      this.authed = !this.opts.token;
      this.decoder.reset();
    });
    port.on('error', (err) => this.log(`error: ${err.message}`));
  }

  private onData(chunk: Buffer): void {
    for (const line of this.decoder.push(chunk.toString('utf8'))) {
      const ev = parseDeviceEvent(line);
      if (!ev) continue;
      if (!this.authed) {
        if (ev.t === 'hello' && ev.token === this.opts.token) this.admit();
        continue;
      }
      if (ev.t === 'hello') continue;
      this.emit('event', { ev, deviceId: this.opts.path });
    }
  }

  private admit(): void {
    this.authed = true;
    this.emit('connect', { deviceId: this.opts.path });
    if (this.lastFrame) this.port?.write(encodeLine(this.lastFrame));
  }

  broadcast(frame: HudFrame): void {
    this.lastFrame = frame;
    if (this.port?.isOpen && this.authed) this.port.write(encodeLine(frame));
  }

  stop(): void {
    this.port?.close();
    this.port = null;
    this.authed = false;
  }

  private log(line: string): void {
    this.opts.log?.(`[serial] ${line}`);
  }
}
