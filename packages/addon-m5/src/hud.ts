/**
 * DaemonSnapshot → HudFrame. Pure: the bridge calls this on every snapshot and
 * ships the result to devices, so the MCU only ever sees the slim frame.
 */
import { STATE_HEX } from '@codesense/core';
import type { DaemonSnapshot } from '@codesense/core';
import type { HudFrame, HudPreset, HudSession } from './protocol.js';

export interface HudOptions {
  /** preset prompts surfaced on the orb (later: sourced from the profile) */
  presets?: HudPreset[];
  /** monotonically increasing sequence stamped onto the frame */
  seq: number;
}

export function snapshotToHud(snapshot: DaemonSnapshot, opts: HudOptions): HudFrame {
  const active = snapshot.activeSessionSlot;

  const sessions: HudSession[] = snapshot.sessions.map((s) => ({
    slot: s.slot,
    state: s.state,
    active: s.slot === active,
    label: s.label,
    costUsd: s.costUsd,
    waiting: s.state === 'permission' && s.slot !== active,
  }));

  const needsYou =
    snapshot.agentState === 'permission' || sessions.some((s) => s.waiting);

  const frame: HudFrame = {
    t: 'hud',
    state: snapshot.agentState,
    hex: STATE_HEX[snapshot.agentState],
    mode: snapshot.mode,
    needsYou,
    backend: snapshot.backend,
    sessions,
    presets: opts.presets ?? [],
    seq: opts.seq,
  };

  if (snapshot.pendingPermission) {
    frame.perm = {
      tool: snapshot.pendingPermission.toolName,
      detail: snapshot.pendingPermission.detail,
    };
  }

  return frame;
}
