/**
 * CodeSense CoreS3 orb — entry point.
 *
 * Wires the network layer to the HUD: HudFrames from the bridge drive the
 * screen; touch events from the screen are sent back to the bridge. The
 * Application instance is the module's default export, which Moddable runs.
 *
 * ⚠️ P1 scaffold — see README.md before the first build/flash.
 */
import { initHud, render } from 'ui';
import { BridgeLink } from 'net';
import type { HudFrame } from 'wire';

let latest: HudFrame | undefined;

const link = new BridgeLink(
  (frame) => {
    latest = frame;
    render(frame);
  },
  (online) => {
    trace(`orb: bridge ${online ? 'online' : 'offline'}\n`);
    if (!online && latest) {
      // show a disconnected placeholder until frames resume
      render({ ...latest, state: 'disconnected', hex: '#5C6470', needsYou: false });
    }
  },
);

const application = initHud((ev) => link.send(ev));

link.start();

export default application;
