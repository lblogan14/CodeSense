/**
 * MQTT device transport (P3) — the fleet / remote / away-from-desk path. The
 * bridge publishes HudFrames to a broker and subscribes for DeviceEvents, so
 * any number of orbs can attach without a direct socket to the daemon host.
 *
 * `mqtt` is loaded lazily (computed import specifier) so `@codesense/addon-m5`
 * builds and tests without it; it's only needed when an MQTT transport starts:
 *
 *   pnpm --filter @codesense/addon-m5 add mqtt
 */
import { Transport } from './transport.js';
import { parseDeviceEvent } from '../protocol.js';
import type { HudFrame } from '../wire.js';

/** Topic layout for a given prefix. Pure — unit-tested. */
export function mqttTopics(prefix: string): { hud: string; event: string } {
  const base = prefix.replace(/\/+$/, '');
  return { hud: `${base}/hud`, event: `${base}/event` };
}

interface MqttClientLike {
  on(event: 'connect' | 'close' | 'error', fn: (arg?: unknown) => void): void;
  on(event: 'message', fn: (topic: string, payload: Buffer) => void): void;
  subscribe(topic: string): void;
  publish(topic: string, message: string, opts?: { retain?: boolean }): void;
  end(): void;
}

export interface MqttTransportOptions {
  /** broker url, e.g. mqtt://192.168.1.10:1883 */
  url: string;
  /** topic prefix (default "codesense/m5") */
  prefix?: string;
  username?: string;
  password?: string;
  log?: (line: string) => void;
}

export class MqttTransport extends Transport {
  readonly name = 'mqtt';
  private client: MqttClientLike | null = null;
  private connected = false;
  private lastFrame: HudFrame | null = null;
  private readonly topics: { hud: string; event: string };

  constructor(private opts: MqttTransportOptions) {
    super();
    this.topics = mqttTopics(opts.prefix ?? 'codesense/m5');
  }

  /** MQTT has no direct device link; report the broker channel as one "device". */
  get deviceCount(): number {
    return this.connected ? 1 : 0;
  }

  async start(): Promise<void> {
    let connect: (url: string, opts?: object) => MqttClientLike;
    try {
      const spec = 'mqtt';
      const mod = (await import(spec)) as { connect: typeof connect };
      connect = mod.connect;
    } catch {
      throw new Error(
        "mqtt transport needs the 'mqtt' package — run: pnpm --filter @codesense/addon-m5 add mqtt",
      );
    }

    const client = connect(this.opts.url, {
      username: this.opts.username,
      password: this.opts.password,
    });
    this.client = client;

    client.on('connect', () => {
      this.connected = true;
      this.log(`connected to ${this.opts.url}`);
      client.subscribe(this.topics.event);
      // publish the latest so a freshly-attached orb renders immediately
      if (this.lastFrame) client.publish(this.topics.hud, JSON.stringify(this.lastFrame), { retain: true });
      this.emit('connect', { deviceId: this.opts.url });
    });
    client.on('message', (topic, payload) => {
      if (topic !== this.topics.event) return;
      const ev = parseDeviceEvent(payload);
      if (ev && ev.t !== 'hello') this.emit('event', { ev, deviceId: this.opts.url });
    });
    client.on('close', () => {
      if (this.connected) this.emit('disconnect', { deviceId: this.opts.url });
      this.connected = false;
    });
    client.on('error', (err) => this.log(`error: ${(err as Error)?.message ?? String(err)}`));
  }

  broadcast(frame: HudFrame): void {
    this.lastFrame = frame;
    if (this.client && this.connected) {
      this.client.publish(this.topics.hud, JSON.stringify(frame), { retain: true });
    }
  }

  stop(): void {
    this.client?.end();
    this.client = null;
    this.connected = false;
  }

  private log(line: string): void {
    this.opts.log?.(`[mqtt] ${line}`);
  }
}
