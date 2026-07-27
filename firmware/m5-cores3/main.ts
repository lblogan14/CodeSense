/**
 * CodeSense CoreS3 orb — entry point.
 *
 * NOTE (P1 status): this renders a minimal, self-contained resting screen and
 * is known to build + run cleanly on the CoreS3. The full HUD (ui.ts + net.ts,
 * driven from main.hud.wip.ts) currently aborts at XS module-graph prepare time
 * on-device — see SETUP.md "Full HUD: known blocker". Debug it with xsbug
 * (`mcconfig -d -m -p esp32/m5stack_cores3`) to get the exact abort reason,
 * then move the HUD back into main.ts.
 */
import { Application, Skin, Style, Label, Content } from 'piu/MC';

// Always silence the CoreS3 amp first (defensive).
try {
  const g = globalThis as unknown as { amp?: { volume: number } };
  if (g.amp) g.amp.volume = 0;
} catch (e) {
  trace(`orb: amp mute failed: ${e}\n`);
}

trace('orb: resting screen\n');

const application = new Application(null, {
  skin: new Skin({ fill: '#0b0d12' }),
  contents: [
    // Sense-blue status strip along the top
    new Content(null, { left: 0, right: 0, top: 0, height: 6, skin: new Skin({ fill: '#3e9bff' }) }),
    new Label(null, {
      style: new Style({ font: '600 28px Open Sans', color: '#e8eaf0', horizontal: 'center' }),
      string: 'CodeSense',
      left: 0,
      right: 0,
      top: 96,
      height: 34,
    }),
    new Label(null, {
      style: new Style({ font: '16px Open Sans', color: '#5c6470', horizontal: 'center' }),
      string: 'orb · ready',
      left: 0,
      right: 0,
      top: 134,
      height: 20,
    }),
  ],
});

trace('orb: resting screen ready\n');

export default application;
