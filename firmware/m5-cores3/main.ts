/**
 * CodeSense CoreS3 orb — entry point.
 *
 * Wires the network layer to the HUD: HudFrames from the bridge drive the
 * screen; touch events from the screen are sent back to the bridge. The
 * Application instance is the module's default export, which Moddable runs.
 */
import { initHud, render } from 'ui';
import { BridgeLink, SerialLink, DemoLink, WifiWatch } from 'links';
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

// diagnostic: is the CoreS3 touch driver registered for Piu?
{
  const g = globalThis as unknown as { device?: { sensor?: { Touch?: unknown } } };
  trace(`orb: touch-setup device=${!!g.device} sensor.Touch=${!!(g.device?.sensor?.Touch)}\n`);
}

let latest: HudFrame | undefined;

// Shown before the first frame arrives and whenever the link is offline, so the
// center is never blank.
const DISCONNECTED: HudFrame = {
  t: 'hud',
  state: 'disconnected',
  hex: '#5C6470',
  mode: 'AGENT',
  needsYou: false,
  backend: 'none',
  sessions: [],
  presets: [],
  seq: 0,
};

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
  if (!online) {
    try {
      render(latest ? { ...latest, state: 'disconnected', hex: '#5C6470', needsYou: false } : DISCONNECTED);
    } catch {
      /* ignore */
    }
  }
};

// transport: "demo" (on-device cycle) | "serial" (wired, TODO) |
// "wifi"/default (BridgeLink — WebSocket to the bridge; WiFi via setup/network).
const transport = (config as { transport?: string }).transport;
const link: Link =
  transport === 'demo'
    ? new DemoLink(onFrame, onStatus)
    : transport === 'serial'
      ? new SerialLink(onFrame, onStatus)
      : new BridgeLink(onFrame, onStatus);

// WiFi self-heal: setup/network connects once then closes its monitor, so a
// dropped link never re-associates. For the wifi (BridgeLink) transport, keep a
// live monitor that re-connects on every drop; on drop, show DISCONNECTED at
// once instead of waiting for the websocket to notice.
const wifiWatch: WifiWatch | undefined =
  transport === 'demo' || transport === 'serial'
    ? undefined
    : new WifiWatch(
        () => trace('orb: wifi link up\n'),
        () => onStatus(false),
      );

let application: unknown;
try {
  trace('orb: initHud...\n');
  application = initHud((ev) => link.send(ev));
  render(DISCONNECTED); // initial paint so the center isn't blank pre-connect
  trace('orb: initHud ok\n');
} catch (e) {
  // Keep the failure visible on the console so a plain serial read can catch it.
  const msg = `orb: initHud FAILED: ${e}\n`;
  trace(msg);
  Timer.repeat(() => trace(msg), 1500);
}

if (application) {
  try {
    wifiWatch?.start();
  } catch (e) {
    trace(`orb: wifiWatch.start failed: ${e}\n`);
  }
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
