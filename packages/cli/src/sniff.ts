import HID from 'node-hid';
import pc from 'picocolors';
import {
  findDualSenseDevices,
  buildBtOutputReport,
  buildUsbOutputReport,
} from '@codesense/hid';
import type { FeedbackFrame } from '@codesense/core';

const redFrame = (): FeedbackFrame => ({
  lightbar: { r: 255, g: 0, b: 0 },
  playerLeds: 0x1f,
  muteLed: false,
  rumble: { low: 0, high: 0 },
  triggers: { l2: { mode: 'off' }, r2: { mode: 'off' } },
});

const hex = (b: Buffer, n: number): string =>
  Buffer.from(b).subarray(0, n).toString('hex').replace(/(..)/g, '$1 ').trim();

/**
 * Low-level HID diagnostic: opens the DualSense and reports exactly what it
 * sends — report IDs, lengths, rate — plus whether the feature-report 0x05
 * read (the Bluetooth full-mode switch) works. `codesense sniff [--usb-only]`
 */
export async function runSniff(allowBluetooth: boolean): Promise<number> {
  console.log(pc.bold('codesense hid sniff'));
  let devs;
  try {
    devs = findDualSenseDevices();
  } catch (err) {
    console.log(`enumeration failed: ${String(err)}`);
    return 1;
  }
  if (!devs.length) {
    console.log('no DualSense found');
    return 1;
  }
  for (const d of devs) {
    console.log(`  found: ${d.product} · pid 0x${d.pid.toString(16)} · guessed ${d.guessedConnection}`);
    console.log(`         ${pc.dim(d.path)}`);
  }
  const pick =
    (allowBluetooth ? undefined : devs.find((d) => d.guessedConnection === 'usb')) ??
    devs.find((d) => d.guessedConnection === 'usb') ??
    devs[0]!;
  console.log(`opening ${pick.product} (${pick.guessedConnection})…`);

  let dev: HID.HID;
  try {
    dev = new HID.HID(pick.path);
  } catch (err) {
    console.log(pc.red(`open failed: ${String(err)}`));
    return 1;
  }

  // The Bluetooth full-mode switch: reading calibration report 0x05 makes the
  // controller start sending the expanded 0x31 input report.
  for (const len of [41, 64]) {
    try {
      const fr = dev.getFeatureReport(0x05, len);
      console.log(`  feature 0x05 (len ${len}): got ${fr.length} bytes  [${hex(Buffer.from(fr), 10)}…]`);
      break;
    } catch (err) {
      console.log(`  feature 0x05 (len ${len}) read failed: ${String(err)}`);
    }
  }

  const kinds = new Map<string, number>();
  const firsts = new Map<string, Buffer>();
  let count = 0;
  const start = Date.now();
  dev.on('data', (b: Buffer) => {
    count++;
    const key = `id=0x${(b[0] ?? 0).toString(16).padStart(2, '0')} len=${b.length}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
    if (!firsts.has(key)) firsts.set(key, Buffer.from(b));
  });
  dev.on('error', (err) => console.log(pc.red(`  device error: ${String(err)}`)));

  console.log('  capturing 3s input baseline…');
  await new Promise((r) => setTimeout(r, 3000));
  const baseSecs = (Date.now() - start) / 1000;
  const baseHz = Math.round(count / baseSecs);
  console.log(`  baseline: ${count} reports (${baseHz} Hz)`);

  // ── write probe: does output stall or throw? ──
  const isBt = pick.guessedConnection === 'bluetooth';
  console.log(`\n  write probe — 12 ${isBt ? 'BT' : 'USB'} lightbar writes (red), timing each…`);
  const beforeWrites = count;
  const probeStart = Date.now();
  let seq = 0;
  const times: number[] = [];
  let writeErr: string | null = null;
  for (let i = 0; i < 12; i++) {
    const frame = redFrame();
    const report = isBt
      ? buildBtOutputReport(frame, seq++, { init: i < 3 })
      : buildUsbOutputReport(frame, { init: i < 3 });
    const t0 = Date.now();
    try {
      dev.write(Array.from(report));
    } catch (err) {
      writeErr = String(err);
      console.log(pc.red(`  write #${i} threw: ${writeErr}`));
      break;
    }
    times.push(Date.now() - t0);
    await new Promise((r) => setTimeout(r, 120));
  }
  const probeSecs = (Date.now() - probeStart) / 1000;
  const duringWrites = count - beforeWrites;
  const duringHz = Math.round(duringWrites / probeSecs);

  if (times.length) {
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    const max = Math.max(...times);
    console.log(`  write() timing: avg ${avg}ms · max ${max}ms · ${times.length} sent`);
  }
  console.log(`  input during writes: ${duringWrites} reports (${duringHz} Hz)  ${pc.dim(`baseline was ${baseHz} Hz`)}`);
  if (!writeErr && times.length) {
    console.log(
      duringHz < baseHz / 2
        ? pc.yellow('  → writes are STALLING the read stream (Windows BT read/write contention)')
        : pc.green('  → writes did not stall input'),
    );
    console.log(
      pc.dim('  → did the lightbar turn RED / player LEDs light up just now? (tells us if the write format lands)'),
    );
  }

  const secs = (Date.now() - start) / 1000;
  console.log(`\n${count} reports in ${secs.toFixed(1)}s (${Math.round(count / secs)} Hz)`);
  for (const [k, v] of kinds) {
    console.log(`  ${k}: ${v}`);
    const f = firsts.get(k)!;
    console.log(`     bytes: ${hex(f, 20)}`);
  }
  if (count === 0) {
    console.log(pc.yellow('\n  no reports at all — Windows BT HID may not be streaming, or a remapper grabbed the device'));
  } else if (![...kinds.keys()].some((k) => k.includes('len=78') || k.includes('len=64'))) {
    console.log(pc.yellow('\n  only short reports — the controller never entered full mode (feature 0x05 switch did not take)'));
  } else {
    console.log(pc.green('\n  full report stream present'));
  }

  try {
    dev.close();
  } catch {
    /* ignore */
  }
  return 0;
}
