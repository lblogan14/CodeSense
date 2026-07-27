/**
 * Network layer for the CoreS3 orb: join WiFi, hold a WebSocket to the
 * CodeSense bridge, hand HudFrames up, and send DeviceEvents down.
 *
 * The wire types come from the SAME file the bridge uses
 * (`packages/addon-m5/src/wire.ts`, included as the `wire` module in
 * manifest.json), so the protocol is defined once in TypeScript.
 *
 * ⚠️ P1 scaffold — validate the Moddable API surface (wifi / websocket / timer)
 * against your installed SDK when you first build. See README.md.
 */
import WiFi from 'wifi';
import { Client } from 'websocket';
import Timer from 'timer';
import config from 'mc/config';
import type { DeviceEvent, HudFrame } from 'wire';

interface BridgeConfig {
  wifi: { ssid: string; password: string };
  bridge: { host: string; port: number; token: string };
}

const cfg = config as unknown as BridgeConfig;

export type FrameHandler = (frame: HudFrame) => void;
export type StatusHandler = (online: boolean) => void;

const RECONNECT_MS = 1500;

export class BridgeLink {
  private ws: Client | undefined;
  private online = false;

  constructor(
    private readonly onFrame: FrameHandler,
    private readonly onStatus: StatusHandler,
  ) {}

  start(): void {
    this.connectWiFi();
  }

  send(ev: DeviceEvent): void {
    if (this.ws && this.online) this.ws.write(JSON.stringify(ev));
  }

  private connectWiFi(): void {
    trace(`wifi: joining "${cfg.wifi.ssid}"\n`);
    // The monitor object must stay referenced for the life of the connection.
    new WiFi({ ssid: cfg.wifi.ssid, password: cfg.wifi.password }, (msg: string) => {
      if (msg === WiFi.gotIP) {
        trace('wifi: got IP\n');
        this.connectWs();
      } else if (msg === WiFi.disconnected) {
        trace('wifi: disconnected\n');
        this.setOnline(false);
      }
    });
  }

  private connectWs(): void {
    const { host, port, token } = cfg.bridge;
    trace(`bridge: connecting ws://${host}:${port}\n`);
    const ws = new Client({ host, port, path: '/' });
    this.ws = ws;

    ws.callback = (message: number, value?: unknown): void => {
      switch (message) {
        case Client.handshake:
          this.setOnline(true);
          trace('bridge: connected\n');
          if (token) this.send({ t: 'hello', token });
          break;
        case Client.receive:
          this.onReceive(value as string);
          break;
        case Client.disconnect:
          trace('bridge: disconnected — retrying\n');
          this.setOnline(false);
          this.ws = undefined;
          Timer.set(() => this.connectWs(), RECONNECT_MS);
          break;
      }
    };
  }

  private onReceive(raw: string): void {
    let frame: HudFrame | undefined;
    try {
      frame = JSON.parse(raw) as HudFrame;
    } catch {
      return;
    }
    if (frame && frame.t === 'hud') this.onFrame(frame);
  }

  private setOnline(v: boolean): void {
    if (this.online === v) return;
    this.online = v;
    this.onStatus(v);
  }
}
