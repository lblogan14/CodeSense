/**
 * The bridge: a plain ws *client* of the daemon (exactly like the dashboard),
 * plus a hub over one or more device transports. It never imports
 * `@codesense/hid` and never mutates the daemon — the orb stays fully
 * decoupled from the DualSense.
 *
 *   daemon snapshot ──▶ HudFrame ──▶ every transport ──▶ device
 *   device DeviceEvent ──▶ daemon ClientMessage ──▶ daemon ws
 */
import { WebSocket } from 'ws';
import { emptyControllerState, idleFeedback } from '@codesense/core';
import type { AgentStateName, DaemonSnapshot } from '@codesense/core';
import { snapshotToHud } from './hud.js';
import { deviceEventToClientMessage } from './protocol.js';
import type { DeviceEvent, HudFrame, HudPreset } from './protocol.js';
import type { Transport } from './transports/transport.js';

export interface PresetDef extends HudPreset {
  /** literal text sent as a prompt when the preset is tapped */
  text: string;
}

export interface BridgeOptions {
  /** daemon ws url, e.g. ws://127.0.0.1:3737/ws */
  daemonUrl: string;
  transports: Transport[];
  presets?: PresetDef[];
  /** synthesize a cycling state instead of connecting to a daemon */
  demo?: boolean;
  log?: (line: string) => void;
}

const RECONNECT_MS = 1500;
const DEMO_RING: AgentStateName[] = ['idle', 'thinking', 'permission', 'done', 'error'];
const DEMO_STEP_MS = 2600;

export class Bridge {
  private daemon: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private seq = 0;
  private lastJson = '';
  private readonly presetText = new Map<string, string>();
  private readonly hudPresets: HudPreset[];

  // demo state
  private demoState: AgentStateName = 'idle';
  private demoTimer: ReturnType<typeof setInterval> | null = null;
  private demoIndex = 0;

  constructor(private opts: BridgeOptions) {
    for (const p of opts.presets ?? []) this.presetText.set(p.id, p.text);
    this.hudPresets = (opts.presets ?? []).map((p) => ({ id: p.id, label: p.label }));
  }

  start(): void {
    for (const t of this.opts.transports) {
      t.on('event', ({ ev, deviceId }) => this.onDeviceEvent(ev, deviceId));
      t.on('connect', ({ deviceId }) =>
        this.log(`device connected · ${deviceId} · via ${t.name} (${t.deviceCount} total)`),
      );
      t.on('disconnect', ({ deviceId }) =>
        this.log(`device disconnected · ${deviceId} · via ${t.name}`),
      );
      void t.start();
    }

    if (this.opts.demo) {
      this.startDemo();
    } else {
      this.connectDaemon();
    }
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.demoTimer) clearInterval(this.demoTimer);
    this.daemon?.close();
    for (const t of this.opts.transports) void t.stop();
  }

  // ── daemon (read + write) ──────────────────────────────────────

  private connectDaemon(): void {
    if (this.closed) return;
    this.log(`connecting to daemon ${this.opts.daemonUrl} …`);
    const ws = new WebSocket(this.opts.daemonUrl);
    this.daemon = ws;

    ws.on('open', () => this.log('daemon connected'));
    ws.on('message', (raw) => this.onDaemonMessage(raw as Buffer));
    ws.on('close', () => {
      if (this.daemon === ws) this.daemon = null;
      if (this.closed) return;
      this.log(`daemon connection closed — retrying in ${RECONNECT_MS}ms`);
      this.reconnectTimer = setTimeout(() => this.connectDaemon(), RECONNECT_MS);
      this.reconnectTimer.unref?.();
    });
    ws.on('error', (err) => this.log(`daemon ws error: ${(err as Error).message}`));
  }

  private onDaemonMessage(raw: Buffer): void {
    let msg: { type?: string; snapshot?: DaemonSnapshot };
    try {
      msg = JSON.parse(raw.toString('utf8')) as typeof msg;
    } catch {
      return;
    }
    if (msg.type === 'snapshot' && msg.snapshot) this.publish(msg.snapshot);
  }

  private sendToDaemon(payload: unknown): void {
    const ws = this.daemon;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      this.log(`(no daemon) would send → ${JSON.stringify(payload)}`);
    }
  }

  // ── snapshot → HudFrame → devices ──────────────────────────────

  private publish(snapshot: DaemonSnapshot): void {
    const frame = snapshotToHud(snapshot, { presets: this.hudPresets, seq: this.seq + 1 });
    // de-dupe: skip frames identical to the last (except the bumping seq)
    const json = JSON.stringify({ ...frame, seq: 0 });
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.seq++;
    frame.seq = this.seq;
    this.broadcast(frame);
  }

  private broadcast(frame: HudFrame): void {
    for (const t of this.opts.transports) t.broadcast(frame);
  }

  // ── device → daemon ────────────────────────────────────────────

  private onDeviceEvent(ev: DeviceEvent, deviceId: string): void {
    // gestures are device-local for now; their daemon semantics are an open
    // design question (see docs/addon-m5-cores3.md §12).
    if (ev.t === 'gesture') {
      this.log(`gesture · ${ev.name} · from ${deviceId}`);
      if (this.opts.demo && ev.name === 'shake') this.advanceDemo();
      return;
    }

    // resolve a preset's text before mapping
    let resolved = ev;
    if (ev.t === 'preset' && !ev.text) {
      const text = this.presetText.get(ev.id);
      if (!text) {
        this.log(`preset "${ev.id}" has no bound text — ignored`);
        return;
      }
      resolved = { ...ev, text };
    }

    const msg = deviceEventToClientMessage(resolved);
    if (!msg) return;
    this.log(`${deviceId} · ${ev.t}${'scope' in ev ? ' ' + ev.scope : ''} → daemon`);
    this.sendToDaemon(msg);

    // in demo mode, reflect approvals/rejections locally so the loop feels real
    if (this.opts.demo && (ev.t === 'approve' || ev.t === 'reject')) {
      this.setDemoState('thinking');
    }
  }

  // ── demo mode (no daemon, no hardware) ─────────────────────────

  private startDemo(): void {
    this.log('demo mode — synthesizing a cycling agent state (no daemon)');
    this.setDemoState(DEMO_RING[0]!);
    this.demoTimer = setInterval(() => this.advanceDemo(), DEMO_STEP_MS);
    this.demoTimer.unref?.();
  }

  private advanceDemo(): void {
    this.demoIndex = (this.demoIndex + 1) % DEMO_RING.length;
    this.setDemoState(DEMO_RING[this.demoIndex]!);
  }

  private setDemoState(state: AgentStateName): void {
    this.demoState = state;
    this.demoIndex = Math.max(0, DEMO_RING.indexOf(state));
    this.publish(makeDemoSnapshot(state));
  }

  private log(line: string): void {
    this.opts.log?.(line);
  }
}

/** A minimal snapshot the hud reads from; other fields are filler. */
function makeDemoSnapshot(state: AgentStateName): DaemonSnapshot {
  return {
    controller: emptyControllerState(),
    feedback: idleFeedback(),
    mode: 'AGENT',
    sessions: [],
    activeSessionSlot: 0,
    agentState: state,
    profileName: 'demo',
    backend: 'pty',
    pendingPermission:
      state === 'permission' ? { toolName: 'Bash', detail: 'rm -rf build/' } : undefined,
  };
}
