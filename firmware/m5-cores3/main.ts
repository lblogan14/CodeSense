/**
 * CodeSense CoreS3 orb — entry point.
 *
 * Wires the network layer to the HUD: HudFrames from the bridge drive the
 * screen; touch events from the screen are sent back to the bridge. The
 * Application instance is the module's default export, which Moddable runs.
 */
import { initHud, render } from 'ui';
import { SerialLink, DemoLink } from 'links';
import type { Link } from 'links';
import config from 'mc/config';
import Timer from 'timer';
import type { HudFrame } from 'wire';

// SAFETY FIRST: silence the CoreS3 amp (AW88298, default volume ~250) before
// anything that could fault — a boot crash otherwise leaves the amp screeching.
try {
  const g = globalThis as unknown as { amp?: { volume: number } };
  if (g.amp) g.amp.volume = 0;
} catch (e) {
  trace(`orb: amp mute failed: ${e}\n`);
}

trace('orb: main start\n');

let latest: HudFrame | undefined;

const onFrame = (frame: HudFrame): void => {
  latest = frame;
  try {
    render(frame);
  } catch (e) {
    trace(`orb: render failed: ${e}\n`);
  }
};

const onStatus = (online: boolean): void => {
  trace(`orb: link ${online ? 'online' : 'offline'}\n`);
  if (!online && latest) {
    try {
      render({ ...latest, state: 'disconnected', hex: '#5C6470', needsYou: false });
    } catch {
      /* ignore */
    }
  }
};

// transport: "serial" (wired, TODO) | "demo"/default (on-device state cycle).
// WiFi/BridgeLink is deferred (see links.ts).
const transport = (config as { transport?: string }).transport;
const link: Link =
  transport === 'serial' ? new SerialLink(onFrame, onStatus) : new DemoLink(onFrame, onStatus);

let application: unknown;
try {
  trace('orb: initHud...\n');
  application = initHud((ev) => link.send(ev));
  trace('orb: initHud ok\n');
} catch (e) {
  // Keep the failure visible on the console so a plain serial read can catch it.
  const msg = `orb: initHud FAILED: ${e}\n`;
  trace(msg);
  Timer.repeat(() => trace(msg), 1500);
}

if (application) {
  try {
    trace('orb: link.start...\n');
    link.start();
    trace('orb: link.start ok\n');
  } catch (e) {
    trace(`orb: link.start failed: ${e}\n`);
    onStatus(false);
  }
}

export default application;
