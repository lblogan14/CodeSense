import pc from 'picocolors';
import { FeedbackRenderer, STATE_HEX } from '@codesense/core';
import type { AgentStateName } from '@codesense/core';
import { DeviceManager, playerLedPattern } from '@codesense/hid';
import { icon } from './ui.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Hardware smoke test: cycles every agent-state lightbar animation,
 * player LED pattern, a rumble pulse, and the R2 resistance effect on
 * the physical controller. `codesense test [--usb-only]`
 */
export async function runTestPattern(allowBluetooth: boolean): Promise<number> {
  console.log(pc.bold('codesense hardware test'));
  const manager = new DeviceManager({ allowBluetooth });
  manager.on('error', ({ message }) => console.log(`${icon.warn} ${message}`));

  const device = await new Promise<import('@codesense/hid').DualSenseLike | null>(
    (resolve) => {
      const timeout = setTimeout(() => resolve(null), 8000);
      manager.on('attach', ({ device: d }) => {
        clearTimeout(timeout);
        resolve(d);
      });
      manager.start(1000);
    },
  );

  if (!device) {
    console.log(`${icon.err} no DualSense found after 8s — plug it in over USB and retry`);
    manager.stop();
    return 1;
  }
  console.log(`${icon.ok} ${device.productName} · ${device.connection}`);

  let inputs = 0;
  let lastBattery = '';
  device.on('input', (state) => {
    inputs++;
    lastBattery = `${state.battery.level}%${state.battery.charging ? ' charging' : ''}`;
  });

  const renderer = new FeedbackRenderer();
  const tick = setInterval(() => device.setFeedback(renderer.frame()), 33);

  const states: AgentStateName[] = ['idle', 'thinking', 'permission', 'done', 'error'];
  for (const s of states) {
    renderer.setState(s);
    renderer.setPlayerLeds(playerLedPattern((states.indexOf(s) % 4) + 1));
    const hex = STATE_HEX[s];
    console.log(`  lightbar → ${pc.bold(s)} ${pc.dim(hex)}${s === 'permission' ? pc.dim('  (R2 should feel weighted — try pulling it)') : ''}`);
    await sleep(s === 'permission' ? 5000 : 2600);
  }

  console.log(`  ${pc.dim('mute LED + rumble pulse')}`);
  renderer.setState('idle');
  renderer.setMuteLed(true);
  renderer.pulse(0.8, 0.5, 300);
  await sleep(700);
  renderer.setMuteLed(false);
  await sleep(300);

  clearInterval(tick);
  device.setFeedback(renderer.frame());
  await sleep(120);
  manager.stop();

  console.log(`${icon.ok} input reports received: ${inputs} ${pc.dim(`(~${Math.round(inputs / 16)} Hz)`)} · battery ${lastBattery}`);
  console.log(
    inputs > 100
      ? `${icon.ok} input + output paths verified`
      : `${icon.warn} very few input reports — check HID contention (codesense doctor)`,
  );
  return 0;
}
