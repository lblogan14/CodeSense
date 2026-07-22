/**
 * DualSense HID protocol: input report parsing and output report building.
 *
 * Offsets follow the cross-checked reference (Linux hid-playstation.c,
 * SDL_hidapi_ps5.c, nondebug/dualsense, controllers.fandom.com).
 * All "abs" offsets include the report-ID byte, matching what node-hid
 * reads and writes on Windows.
 */

import type {
  ButtonName,
  ControllerState,
  FeedbackFrame,
  TriggerEffect,
} from '@codesense/core';
import { emptyControllerState } from '@codesense/core';

export const SONY_VID = 0x054c;
export const DUALSENSE_PID = 0x0ce6;
export const DUALSENSE_EDGE_PID = 0x0df2;

export const USB_INPUT_REPORT_ID = 0x01;
export const BT_INPUT_REPORT_ID = 0x31;
export const USB_OUTPUT_REPORT_ID = 0x02;
export const BT_OUTPUT_REPORT_ID = 0x31;

export const USB_OUTPUT_LEN = 48;
export const BT_OUTPUT_LEN = 78;

const CRC32_SEED_OUTPUT = 0xa2;

// ─── CRC-32 (zlib/IEEE 802.3, reflected 0xEDB88320) ──────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Iterable<number>, start = 0xffffffff): number {
  let crc = start >>> 0;
  for (const b of bytes) {
    crc = (CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── Input parsing ───────────────────────────────────────────────

const HAT_MAP: Record<number, Partial<Record<ButtonName, boolean>>> = {
  0: { dpadUp: true },
  1: { dpadUp: true, dpadRight: true },
  2: { dpadRight: true },
  3: { dpadRight: true, dpadDown: true },
  4: { dpadDown: true },
  5: { dpadDown: true, dpadLeft: true },
  6: { dpadLeft: true },
  7: { dpadLeft: true, dpadUp: true },
  8: {},
};

function axis(v: number): number {
  // 0..255 → -1..1 (128 = center)
  return Math.max(-1, Math.min(1, (v - 128) / 127));
}

/**
 * Parse a DualSense input report. Handles USB 0x01 (64 B) and Bluetooth
 * 0x31 (78 B, state block shifted +1). Returns null for reports we don't
 * understand (e.g. the 10-byte BT simplified report — caller should
 * request feature report 0x05 to switch the controller to full mode).
 */
export function parseInputReport(buf: Buffer): ControllerState | null {
  let o: number; // offset of the state block's first byte (left stick X)
  let connection: 'usb' | 'bluetooth';
  if (buf[0] === USB_INPUT_REPORT_ID && buf.length >= 63) {
    o = 1;
    connection = 'usb';
  } else if (buf[0] === BT_INPUT_REPORT_ID && buf.length >= 70) {
    o = 2;
    connection = 'bluetooth';
  } else {
    return null;
  }

  const state = emptyControllerState();
  state.connected = true;
  state.connection = connection;
  state.timestamp = Date.now();

  state.sticks.left.x = axis(buf[o + 0]!);
  state.sticks.left.y = axis(buf[o + 1]!);
  state.sticks.right.x = axis(buf[o + 2]!);
  state.sticks.right.y = axis(buf[o + 3]!);
  state.triggers.l2 = buf[o + 4]! / 255;
  state.triggers.r2 = buf[o + 5]! / 255;

  const b0 = buf[o + 7]!;
  const b1 = buf[o + 8]!;
  const b2 = buf[o + 9]!;

  const hat = HAT_MAP[b0 & 0x0f] ?? {};
  state.buttons.dpadUp = Boolean(hat.dpadUp);
  state.buttons.dpadRight = Boolean(hat.dpadRight);
  state.buttons.dpadDown = Boolean(hat.dpadDown);
  state.buttons.dpadLeft = Boolean(hat.dpadLeft);
  state.buttons.square = Boolean(b0 & 0x10);
  state.buttons.cross = Boolean(b0 & 0x20);
  state.buttons.circle = Boolean(b0 & 0x40);
  state.buttons.triangle = Boolean(b0 & 0x80);

  state.buttons.l1 = Boolean(b1 & 0x01);
  state.buttons.r1 = Boolean(b1 & 0x02);
  state.buttons.l2 = Boolean(b1 & 0x04);
  state.buttons.r2 = Boolean(b1 & 0x08);
  state.buttons.create = Boolean(b1 & 0x10);
  state.buttons.options = Boolean(b1 & 0x20);
  state.buttons.l3 = Boolean(b1 & 0x40);
  state.buttons.r3 = Boolean(b1 & 0x80);

  state.buttons.ps = Boolean(b2 & 0x01);
  state.buttons.touchpad = Boolean(b2 & 0x02);
  state.buttons.mute = Boolean(b2 & 0x04);

  // touch points at state offsets 32..35 and 36..39 (USB abs 33/37)
  for (let i = 0; i < 2; i++) {
    const t = o + 32 + i * 4;
    const b = buf[t]!;
    const x = buf[t + 1]! | ((buf[t + 2]! & 0x0f) << 8);
    const y = ((buf[t + 2]! & 0xf0) >> 4) | (buf[t + 3]! << 4);
    state.touchpad.points[i]! = {
      active: (b & 0x80) === 0, // active-low
      id: b & 0x7f,
      x,
      y,
    };
  }

  // battery at state offset 52 (USB abs 53)
  const batt = buf[o + 52]!;
  const level = Math.min((batt & 0x0f) * 10 + 5, 100);
  const chargeState = (batt >> 4) & 0x0f;
  state.battery = { level, charging: chargeState === 0x01 };

  return state;
}

// ─── Output building ─────────────────────────────────────────────

/** Encode a TriggerEffect into an 11-byte block (Nielk1 opcodes). */
export function encodeTriggerEffect(effect: TriggerEffect): Uint8Array {
  const block = new Uint8Array(11);
  switch (effect.mode) {
    case 'off':
      block[0] = 0x05; // official off/reset
      break;
    case 'resistance': {
      block[0] = 0x21; // official Feedback
      const position = Math.max(0, Math.min(9, Math.round(effect.start * 9)));
      const strength = Math.max(1, Math.min(8, Math.round(1 + effect.strength * 7)));
      const forceValue = (strength - 1) & 0x07;
      let activeZones = 0;
      let forceZones = 0;
      for (let i = position; i < 10; i++) {
        activeZones |= 1 << i;
        forceZones |= forceValue << (3 * i);
      }
      block[1] = activeZones & 0xff;
      block[2] = (activeZones >> 8) & 0xff;
      block[3] = forceZones & 0xff;
      block[4] = (forceZones >>> 8) & 0xff;
      block[5] = (forceZones >>> 16) & 0xff;
      block[6] = (forceZones >>> 24) & 0xff;
      break;
    }
    case 'section': {
      block[0] = 0x25; // official Weapon
      const start = Math.max(2, Math.min(7, Math.round(effect.start * 9)));
      const end = Math.max(start + 1, Math.min(8, Math.round(effect.end * 9)));
      const strength = Math.max(1, Math.min(8, Math.round(1 + effect.strength * 7)));
      const zones = (1 << start) | (1 << end);
      block[1] = zones & 0xff;
      block[2] = (zones >> 8) & 0xff;
      block[3] = (strength - 1) & 0x07;
      break;
    }
    case 'vibration': {
      block[0] = 0x26; // official Vibration
      const position = Math.max(0, Math.min(9, Math.round(effect.start * 9)));
      const amplitude = Math.max(1, Math.min(8, Math.round(1 + effect.amplitude * 7)));
      const ampValue = (amplitude - 1) & 0x07;
      let activeZones = 0;
      let amplitudeZones = 0;
      for (let i = position; i < 10; i++) {
        activeZones |= 1 << i;
        amplitudeZones |= ampValue << (3 * i);
      }
      block[1] = activeZones & 0xff;
      block[2] = (activeZones >> 8) & 0xff;
      block[3] = amplitudeZones & 0xff;
      block[4] = (amplitudeZones >>> 8) & 0xff;
      block[5] = (amplitudeZones >>> 16) & 0xff;
      block[6] = (amplitudeZones >>> 24) & 0xff;
      block[9] = Math.max(0, Math.min(255, Math.round(effect.frequency)));
      break;
    }
  }
  return block;
}

/** PS5-style player LED patterns per active session slot (1..4). */
export function playerLedPattern(slot: number): number {
  switch (slot) {
    case 1:
      return 0x04;
    case 2:
      return 0x0a;
    case 3:
      return 0x15;
    case 4:
      return 0x1b;
    default:
      return 0;
  }
}

export interface OutputBuildOptions {
  /** first report after connect: release LEDs from firmware control */
  init?: boolean;
}

/**
 * Build the 47-byte SetStateData common block from a FeedbackFrame.
 * The caller frames it for USB (0x02) or Bluetooth (0x31 + CRC).
 */
function buildCommonBlock(frame: FeedbackFrame, opts: OutputBuildOptions): Uint8Array {
  const p = new Uint8Array(47);
  // valid_flag0: rumble (bits 0|1) + R2 effect (bit 2) + L2 effect (bit 3)
  p[0] = 0x0f;
  // valid_flag1: mute LED (bit0) + lightbar (bit2) + player LEDs (bit4)
  p[1] = 0x01 | 0x04 | 0x10;
  if (opts.init) p[1] |= 0x08; // release LEDs from firmware control
  p[2] = Math.round(Math.max(0, Math.min(1, frame.rumble.high)) * 255); // right/high-freq
  p[3] = Math.round(Math.max(0, Math.min(1, frame.rumble.low)) * 255); // left/low-freq
  p[8] = frame.muteLed ? 1 : 0;
  p.set(encodeTriggerEffect(frame.triggers.r2), 10);
  p.set(encodeTriggerEffect(frame.triggers.l2), 21);
  // valid_flag2: improved rumble (bit2); + lightbar-setup on init (bit1)
  p[38] = 0x04 | (opts.init ? 0x02 : 0);
  if (opts.init) p[41] = 0x02; // lightbar setup: take over from firmware
  p[43] = (frame.playerLeds & 0x1f) | 0x20; // bit5 = change instantly
  p[44] = frame.lightbar.r & 0xff;
  p[45] = frame.lightbar.g & 0xff;
  p[46] = frame.lightbar.b & 0xff;
  return p;
}

/** Build the 48-byte USB output report (ID 0x02). */
export function buildUsbOutputReport(
  frame: FeedbackFrame,
  opts: OutputBuildOptions = {},
): Buffer {
  const buf = Buffer.alloc(USB_OUTPUT_LEN);
  buf[0] = USB_OUTPUT_REPORT_ID;
  buf.set(buildCommonBlock(frame, opts), 1);
  return buf;
}

/**
 * Build the 78-byte Bluetooth output report (ID 0x31), kernel/SDL framing:
 * byte1 = seq<<4, byte2 = 0x10 tag, payload at 3, CRC-32 (seed 0xA2 over
 * bytes 0..73) little-endian at 74..77.
 */
export function buildBtOutputReport(
  frame: FeedbackFrame,
  seq: number,
  opts: OutputBuildOptions = {},
): Buffer {
  const buf = Buffer.alloc(BT_OUTPUT_LEN);
  buf[0] = BT_OUTPUT_REPORT_ID;
  buf[1] = (seq & 0x0f) << 4;
  buf[2] = 0x10;
  buf.set(buildCommonBlock(frame, opts), 3);
  const crc = crc32([CRC32_SEED_OUTPUT, ...buf.subarray(0, 74)]);
  buf.writeUInt32LE(crc >>> 0, 74);
  return buf;
}
