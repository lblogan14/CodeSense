/**
 * Device links for the CoreS3 orb.
 *
 * WiFi is deferred, so the network link (BridgeLink over WebSocket) is omitted
 * for now — importing `wifi`/`websocket` also pulls in Moddable's `setup/network`
 * preload, which tries to join WiFi at boot. The firmware currently runs the
 * on-device DemoLink, or SerialLink once the wired path is built.
 *
 * To re-enable WiFi later: add `manifest_net.json` + the websocket manifest back
 * to manifest.json, restore the `wifi`/`websocket` imports, and reinstate a
 * BridgeLink (see git history of this file).
 */
import Timer from 'timer';
import type { DeviceEvent, HudFrame, WireAgentState } from 'wire';

trace('links: LOADING\n');

export type FrameHandler = (frame: HudFrame) => void;
export type StatusHandler = (online: boolean) => void;

/** Common shape for every device link (demo today; serial / WiFi later). */
export interface Link {
  start(): void;
  send(ev: DeviceEvent): void;
}

/**
 * Wired serial link (P2). NOT YET IMPLEMENTED on the CoreS3.
 *
 * The CoreS3's USB-C is the ESP32-S3 USB-Serial-JTAG (the COM port used for
 * flashing), which Moddable's `embedded:io/serial` does not drive — that module
 * is a hardware UART on GPIO pins. A wired data link therefore needs EITHER a
 * USB-UART adapter on the Grove/UART pins, OR custom USB-Serial-JTAG code.
 * Until then this stays offline instead of crashing the app. See SETUP.md.
 */
export class SerialLink implements Link {
  constructor(
    private readonly onFrame: FrameHandler,
    private readonly onStatus: StatusHandler,
  ) {}

  start(): void {
    trace('serial: wired link not implemented on CoreS3 USB-C (see SETUP.md)\n');
    this.onStatus(false);
  }

  send(_ev: DeviceEvent): void {
    /* no-op until the wired link is implemented */
  }
}

/**
 * On-device demo link — no host needed. Cycles the agent states on a timer so
 * the HUD (colors, fonts, tabs, animation) can be validated on the real screen.
 * Select with `config.transport = "demo"`.
 */
export class DemoLink implements Link {
  private i = 0;

  constructor(
    private readonly onFrame: FrameHandler,
    private readonly onStatus: StatusHandler,
  ) {}

  start(): void {
    this.onStatus(true);
    this.tick();
    Timer.repeat(() => this.tick(), 2600);
  }

  send(ev: DeviceEvent): void {
    // In demo mode any tap/interaction jumps to the next state — this makes the
    // touchscreen visibly responsive and confirms touch is working.
    trace(`orb: demo advance (${ev.t})\n`);
    this.tick();
  }

  private tick(): void {
    const ring: Array<{ state: WireAgentState; hex: string; perm?: { tool: string; detail: string } }> = [
      { state: 'idle', hex: '#3E9BFF' },
      { state: 'thinking', hex: '#9D7CFF' },
      { state: 'permission', hex: '#FFB020', perm: { tool: 'Bash', detail: 'rm -rf build/' } },
      { state: 'done', hex: '#2FD48A' },
      { state: 'error', hex: '#FF5C5C' },
    ];
    const s = ring[this.i % ring.length]!;
    this.i++;
    trace(`orb: demo ${s.state}\n`);
    this.onFrame({
      t: 'hud',
      state: s.state,
      hex: s.hex,
      mode: 'AGENT',
      needsYou: s.state === 'permission',
      backend: 'pty',
      perm: s.perm,
      sessions: [],
      presets: [],
      seq: this.i,
    });
  }
}
