/**
 * Device links for the CoreS3 orb:
 *   - DemoLink   — on-device state cycle, no host (config.transport = "demo").
 *   - SerialLink — wired over USB-CDC (TODO on this board).
 *
 * BridgeLink (WiFi + WebSocket) is preserved in bridgelink.wip.ts — re-enabling
 * the network stack currently boot-crashes at XS prepare time (see SETUP.md
 * "WiFi transport: known blocker"), so it's kept out of the compiled graph.
 *
 * Wire types come from the shared `wire` module (defined once, with the bridge).
 * This module is named `links`, NOT `net` — `net` is a preloaded Moddable
 * builtin and collides (a duplicate net.xsb aborts XS at prepare time).
 */
import Timer from 'timer';
import type { DeviceEvent, HudFrame, WireAgentState } from 'wire';

trace('links: LOADING\n');

export type FrameHandler = (frame: HudFrame) => void;
export type StatusHandler = (online: boolean) => void;

/** Common shape for every device link. */
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
 * A tap jumps to the next state and pauses the auto-cycle (unmistakable touch
 * feedback). Select with `config.transport = "demo"`.
 */
export class DemoLink implements Link {
  private i = 0;
  private timer: unknown;

  constructor(
    private readonly onFrame: FrameHandler,
    private readonly onStatus: StatusHandler,
  ) {}

  start(): void {
    this.onStatus(true);
    this.tick();
    this.schedule(2600);
  }

  send(ev: DeviceEvent): void {
    // A tap jumps to the next state NOW and pauses the auto-cycle ~5s, so the
    // touch is unmistakable — the cycling visibly stops when you touch.
    trace(`orb: demo TAP (${ev.t}) -> jump + pause\n`);
    this.tick();
    this.schedule(5000);
  }

  private schedule(ms: number): void {
    if (this.timer) Timer.clear(this.timer as never);
    this.timer = Timer.set(() => {
      this.tick();
      this.schedule(2600);
    }, ms);
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
