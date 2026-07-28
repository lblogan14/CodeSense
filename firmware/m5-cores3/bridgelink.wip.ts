/**
 * WiFi BridgeLink — WIP, preserved (NOT compiled; not in manifest.json modules).
 *
 * Re-enabling the WiFi / network stack currently **boot-crashes the CoreS3 at XS
 * module-graph prepare time** — before any app code runs, with no console abort
 * (it goes to the xsbug channel). Ruled out: it is NOT a module-name collision
 * (our module is `links`, and the build shows no "too many rules" warning) and
 * NOT memory (a 4× larger XS `creation` heap did not help). It needs xsbug to
 * read the exact abort reason.
 *
 * To resume the WiFi transport:
 *   1. `mcconfig -d -m -p esp32/m5stack_cores3` and read the abort in xsbug.
 *   2. Move this BridgeLink class back into links.ts.
 *   3. Re-add to manifest.json includes:
 *        "$(MODDABLE)/examples/manifest_net.json",
 *        "$(MODULES)/network/websocket/manifest.json"
 *   4. Set config.transport = "wifi" (manifest.local.json) + real WiFi creds.
 *
 * Note: setup/network (Moddable) uses the ECMA-419 `embedded:network/interface/wifi`,
 * while this uses the legacy `wifi` module — worth checking whether pulling in
 * both is the culprit (try the ECMA-419 WiFi here instead).
 *
 * See SETUP.md "WiFi transport: known blocker".
 */
import WiFi from 'wifi';
import { Client } from 'websocket';
import Timer from 'timer';
import config from 'mc/config';
import type { DeviceEvent, HudFrame } from 'wire';
import type { Link, FrameHandler, StatusHandler } from 'links';

interface BridgeConfig {
  wifi: { ssid: string; password: string };
  bridge: { host: string; port: number; token: string };
}
const cfg = config as unknown as BridgeConfig;
const RECONNECT_MS = 2000;

export class BridgeLink implements Link {
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
