import fs from 'node:fs';
import path from 'node:path';
import {
  AgentStateMachine,
  FeedbackRenderer,
  MappingEngine,
  TypedEmitter,
  safeParseProfile,
} from '@codesense/core';
import type {
  Action,
  ControllerState,
  DaemonSnapshot,
  ModeName,
  Profile,
} from '@codesense/core';
import { emptyControllerState } from '@codesense/core';
import {
  DeviceManager,
  MockDualSense,
  playerLedPattern,
} from '@codesense/hid';
import type { DualSenseLike } from '@codesense/hid';
import {
  DEFAULT_DISPATCHER_CONFIG,
  HooksTailer,
  PtyDispatcher,
  PtySession,
  hooksInstalled,
  looksDestructive,
} from '@codesense/backend-pty';
import { SessionManager } from '@codesense/backend-sdk';

export interface DaemonOptions {
  backend: 'pty' | 'sdk';
  mock: boolean;
  profilePath: string;
  cwd: string;
  brightness: number;
  haptics: boolean;
  adaptiveTriggers: boolean;
  claudeCommand: string;
  claudeArgs: string[];
  experimentalBt: boolean;
  log: (line: string) => void;
}

export interface PaletteState {
  open: boolean;
  name: string;
  entries: { label: string }[];
  selected: number;
}

export interface DaemonEvents extends Record<string, unknown> {
  snapshot: DaemonSnapshot;
  palette: PaletteState;
  log: { line: string };
  transcript: { slot: number; role: 'user' | 'assistant'; text: string };
  'pty-exit': { exitCode: number };
}

const SNAPSHOT_INTERVAL_MS = 100;
const RENDER_INTERVAL_MS = 33;

/**
 * The CodeSense daemon: controller ⇄ (mapping engine, renderer) ⇄ backend.
 */
export class Daemon extends TypedEmitter<DaemonEvents> {
  readonly opts: DaemonOptions;
  profile: Profile;
  readonly engine: MappingEngine;
  readonly renderer: FeedbackRenderer;
  readonly stateMachine = new AgentStateMachine();
  readonly sessions = new SessionManager();

  private device: DualSenseLike | null = null;
  private deviceManager: DeviceManager | null = null;
  mock: MockDualSense | null = null;

  pty: PtySession | null = null;
  private dispatcher: PtyDispatcher | null = null;
  private tailer: HooksTailer | null = null;

  private controller: ControllerState = emptyControllerState();
  private palette: PaletteState = { open: false, name: '', entries: [], selected: 0 };
  private renderTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private blinkPhase = false;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private pendingPermissionDetail: { toolName?: string; detail?: string } | undefined;
  /** live subagent count (pty mode) → player LEDs */
  private subagentCount = 0;
  /** mode-change LED flash: N flashes signal the new mode */
  private modeFlash: { count: number; startedAt: number } | null = null;

  constructor(opts: DaemonOptions) {
    super();
    this.opts = opts;
    this.profile = loadProfile(opts.profilePath);
    this.engine = new MappingEngine(this.profile);
    this.renderer = new FeedbackRenderer({
      brightness: opts.brightness,
      haptics: opts.haptics,
      adaptiveTriggers: opts.adaptiveTriggers,
    });
    this.wireEngine();
    this.wireStateSources();
  }

  // ── lifecycle ────────────────────────────────────────────────

  start(): void {
    // controller
    if (this.opts.mock) {
      this.mock = new MockDualSense();
      this.attachDevice(this.mock);
      this.log('virtual controller ready (mock mode)');
    } else {
      this.deviceManager = new DeviceManager({ allowBluetooth: this.opts.experimentalBt });
      this.deviceManager.on('attach', ({ device }) => {
        this.attachDevice(device);
        this.log(`controller connected · ${device.productName} · ${device.connection}`);
      });
      this.deviceManager.on('detach', ({ reason }) => {
        this.device = null;
        this.controller = emptyControllerState();
        this.log(`controller disconnected (${reason})`);
      });
      this.deviceManager.on('error', ({ message }) => this.log(`hid: ${message}`));
      this.deviceManager.start();
    }

    // backend
    if (this.opts.backend === 'pty') {
      this.startPtyBackend();
    } else {
      this.stateMachine.set('idle');
      this.renderer.setState('idle');
      this.engine.agentState = 'idle';
      this.log('sdk backend ready — start sessions from the dashboard');
    }

    // render + snapshot loops
    this.renderTimer = setInterval(() => this.renderTick(), RENDER_INTERVAL_MS);
    this.snapshotTimer = setInterval(() => this.emitSnapshot(), SNAPSHOT_INTERVAL_MS);
    this.blinkTimer = setInterval(() => (this.blinkPhase = !this.blinkPhase), 400);
    for (const t of [this.renderTimer, this.snapshotTimer, this.blinkTimer]) t.unref?.();
  }

  stop(): void {
    if (this.renderTimer) clearInterval(this.renderTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    if (this.blinkTimer) clearInterval(this.blinkTimer);
    this.tailer?.stop();
    this.dispatcher?.dispose();
    this.pty?.kill();
    this.sessions.closeAll();
    this.deviceManager?.stop();
    this.mock?.close();
    this.device = null;
  }

  // ── backends ─────────────────────────────────────────────────

  private startPtyBackend(): void {
    if (!hooksInstalled()) {
      this.log('claude hooks not installed — lightbar state will be blind. run: codesense hooks install');
    }
    this.tailer = new HooksTailer();
    this.tailer.on('event', (event) => {
      switch (event.kind) {
        case 'permission-request':
          this.pendingPermissionDetail = {
            toolName: event.toolName,
            detail: event.detail,
          };
          if (looksDestructive(event.detail)) {
            // sharper double-buzz: this approval deserves a look first
            this.renderer.pulse(1, 0.8, 140);
            setTimeout(() => this.renderer.pulse(1, 0.8, 140), 220).unref?.();
            this.log(`⚠ destructive-looking: ${event.detail}`);
          }
          break;
        case 'subagent-start':
          this.subagentCount++;
          break;
        case 'subagent-end':
          this.subagentCount = Math.max(0, this.subagentCount - 1);
          this.renderer.pulse(0.35, 0.2, 70); // a helper finished
          break;
        case 'notification':
          this.renderer.pulse(0.45, 0.25, 90); // background task update
          break;
        case 'stop':
        case 'session-start':
        case 'session-end':
          this.subagentCount = 0;
          break;
      }
      this.stateMachine.ingest(event);
    });
    this.tailer.on('error', ({ message }) => this.log(`hooks tailer: ${message}`));
    this.tailer.start();

    this.pty = new PtySession({
      command: this.opts.claudeCommand,
      args: this.opts.claudeArgs,
      cwd: this.opts.cwd,
    });
    this.dispatcher = this.buildDispatcher(this.pty);
    this.pty.on('exit', ({ exitCode }) => this.emit('pty-exit', { exitCode }));
    this.pty.start();
    this.stateMachine.set('idle');
  }

  // ── wiring ───────────────────────────────────────────────────

  private attachDevice(device: DualSenseLike): void {
    this.device = device;
    device.on('input', (state) => {
      this.controller = state;
      this.engine.update(state);
    });
  }

  private wireEngine(): void {
    this.engine.on('action', ({ action, gesture }) => {
      void this.handleAction(action, gesture);
    });
    this.engine.on('gesture', ({ gesture }) => {
      if (this.palette.open) this.handlePaletteGesture(gesture);
    });
    this.engine.on('approvalPull', ({ value }) => this.renderer.setApprovalPull(value));
    this.engine.on('mode', ({ mode }) => {
      this.renderer.pulse(0.3, 0.15, 40);
      // LED flash count signals the mode: AGENT=1, NAV=2, PROMPT=3
      this.modeFlash = {
        count: ['AGENT', 'NAV', 'PROMPT'].indexOf(mode) + 1,
        startedAt: Date.now(),
      };
      this.log(`mode → ${mode}`);
    });
  }

  private wireStateSources(): void {
    this.stateMachine.on('change', ({ state }) => {
      if (this.opts.backend === 'pty') {
        this.renderer.setState(state);
        this.engine.agentState = state;
        if (state !== 'permission') this.pendingPermissionDetail = undefined;
      }
    });
    this.sessions.on('active-state', ({ state }) => {
      if (this.opts.backend === 'sdk') {
        this.renderer.setState(state);
        this.engine.agentState = state;
      }
    });
    this.sessions.on('permission', ({ slot, pending }) => {
      this.pendingPermissionDetail = { toolName: pending.toolName };
      this.log(`session ${slot} · waiting for you · ${pending.toolName}`);
      if (slot !== this.sessions.activeSlot) this.renderer.pulse(0.6, 0.4, 120);
    });
    this.sessions.on('text', ({ slot, text }) => {
      this.emit('transcript', { slot, role: 'assistant', text });
    });
    // pty backend: hook events carry tool names for permission display
    // (tailer wiring happens in startPtyBackend)
  }

  // ── action handling ──────────────────────────────────────────

  async handleAction(action: Action, gesture = 'dashboard'): Promise<void> {
    // while palette is open the palette owns navigation gestures
    if (this.palette.open && isPaletteNavGesture(gesture)) return;

    switch (action.type) {
      case 'mode':
        // MappingEngine already switched modes; nothing else to do
        return;
      case 'palette':
        // during a permission dialog, ▢ asks "what am I approving?" —
        // Claude Code's Ctrl+E toggles the command explanation
        if (this.currentAgentState() === 'permission' && this.opts.backend === 'pty') {
          this.dispatcher && (await this.dispatcher.dispatch({ type: 'keys', keys: '\u0005' }));
          return;
        }
        this.openPalette(action.palette);
        return;
      case 'macro': {
        const macro = this.profile.macros[action.id];
        if (!macro) return this.log(`unknown macro "${action.id}"`);
        for (const step of macro) await this.handleAction(step, `macro:${action.id}`);
        return;
      }
      case 'replay-status':
        this.renderer.replayStatus();
        return;
      case 'session':
        if (this.opts.backend === 'sdk') {
          if (action.target === 'next' || action.target === 'prev') {
            this.sessions.cycle(action.target);
          } else {
            this.sessions.setActive(action.target);
          }
          this.renderer.pulse(0.25, 0.1, 35);
        } else {
          this.log('session switching needs the sdk backend (codesense start --backend sdk)');
        }
        return;
      case 'approve': {
        if (this.opts.backend === 'sdk') {
          this.sessions.resolveActivePermission(action.scope);
        } else {
          await this.dispatcher?.dispatch(action);
          this.stateMachine.ingest({ kind: 'permission-resolved', timestamp: Date.now() });
        }
        this.renderer.pulse(0.5, 0.3, action.scope === 'always' ? 140 : 70);
        this.log(`approved (${action.scope}) via ${gesture}`);
        return;
      }
      case 'reject':
        if (this.opts.backend === 'sdk') {
          this.sessions.resolveActivePermission('deny');
        } else {
          await this.dispatcher?.dispatch(action);
          this.stateMachine.ingest({ kind: 'permission-resolved', timestamp: Date.now() });
        }
        this.log(`rejected via ${gesture}`);
        return;
      default:
        break;
    }

    if (this.opts.backend === 'pty') {
      await this.dispatcher?.dispatch(action);
      if (action.type === 'dial' && this.dispatcher) {
        const { index, presets } = this.dispatcher.dial;
        this.renderer.dialFlash(index / Math.max(1, presets.length - 1));
        this.log(`dial → ${presets[index]}`);
      }
    } else {
      // SDK backend: literal text becomes a prompt to the active session
      if (action.type === 'text') {
        this.promptSdk(this.sessions.activeSlot, action.text);
      }
      // keys/slash/dial/voice are terminal concepts — ignored in sdk mode
    }
  }

  promptSdk(slot: number, text: string, cwd?: string): void {
    try {
      this.sessions.prompt(slot, cwd ?? this.opts.cwd, text);
      this.emit('transcript', { slot, role: 'user', text });
      this.log(`session ${slot} ← prompt (${text.length} chars)`);
    } catch (err) {
      this.log(String(err));
    }
  }

  /** Type a prompt into the pty (dashboard prompt box in pty mode). */
  async promptPty(text: string): Promise<void> {
    if (!this.pty) return;
    await this.pty.type(text);
    this.pty.write('\r');
  }

  // ── palette ──────────────────────────────────────────────────

  openPalette(name: string): void {
    const entries = this.profile.palettes[name];
    if (!entries?.length) {
      this.log(`palette "${name}" is empty`);
      return;
    }
    this.palette = {
      open: true,
      name,
      entries: entries.map((e) => ({ label: e.label })),
      selected: 0,
    };
    this.renderer.pulse(0.25, 0.15, 40);
    this.emit('palette', this.palette);
  }

  closePalette(): void {
    this.palette = { open: false, name: '', entries: [], selected: 0 };
    this.emit('palette', this.palette);
  }

  paletteSelect(index: number): void {
    if (!this.palette.open) return;
    this.palette.selected = Math.max(0, Math.min(this.palette.entries.length - 1, index));
    this.emit('palette', this.palette);
  }

  async paletteConfirm(): Promise<void> {
    if (!this.palette.open) return;
    const entries = this.profile.palettes[this.palette.name];
    const entry = entries?.[this.palette.selected];
    this.closePalette();
    if (entry) {
      this.log(`palette → ${entry.label}`);
      await this.handleAction(entry.action, 'palette');
    }
  }

  private handlePaletteGesture(gesture: string): void {
    switch (gesture) {
      case 'dpadUp.press':
      case 'lstick.up':
        this.paletteSelect(this.palette.selected - 1);
        this.renderer.pulse(0.15, 0.1, 25);
        break;
      case 'dpadDown.press':
      case 'lstick.down':
        this.paletteSelect(this.palette.selected + 1);
        this.renderer.pulse(0.15, 0.1, 25);
        break;
      case 'cross.press':
        void this.paletteConfirm();
        break;
      case 'circle.press':
      case 'square.press':
        this.closePalette();
        break;
    }
  }

  // ── profile management ───────────────────────────────────────

  applyProfile(json: unknown): { ok: boolean; error?: string } {
    const res = safeParseProfile(json);
    if (!res.ok) return { ok: false, error: res.error };
    this.profile = res.profile;
    this.engine.setProfile(res.profile);
    if (this.pty && this.dispatcher) {
      this.dispatcher.dispose();
      this.dispatcher = this.buildDispatcher(this.pty); // pick up dialCommands
    }
    fs.writeFileSync(this.opts.profilePath, JSON.stringify(json, null, 2) + '\n');
    this.log(`profile "${res.profile.name}" applied + saved`);
    return { ok: true };
  }

  // ── render + snapshot ────────────────────────────────────────

  private renderTick(): void {
    let mask: number;
    if (this.opts.backend === 'sdk') {
      // active slot pattern; blink in any slot awaiting permission
      mask = playerLedPattern(this.sessions.activeSlot);
      const waiting = this.sessions.slotsAwaitingPermission();
      if (waiting.length && this.blinkPhase) {
        for (const slot of waiting) mask |= playerLedPattern(slot);
      }
    } else {
      // pty mode: more lights = more live subagents (0 → center anchor)
      mask =
        this.subagentCount >= 4
          ? 0x1f
          : playerLedPattern(Math.min(4, this.subagentCount + 1));
    }

    // mode-change flash overrides: N 400 ms flashes announce the new mode
    if (this.modeFlash) {
      const elapsed = Date.now() - this.modeFlash.startedAt;
      if (elapsed >= this.modeFlash.count * 400) {
        this.modeFlash = null;
      } else {
        mask = elapsed % 400 < 220 ? 0x1f : 0;
      }
    }

    this.renderer.setPlayerLeds(mask);
    this.renderer.setMuteLed(this.engine.mode === 'PROMPT');
    this.device?.setFeedback(this.renderer.frame());
  }

  private currentAgentState() {
    return this.opts.backend === 'sdk' ? this.sessions.activeState : this.stateMachine.state;
  }

  private buildDispatcher(pty: PtySession): PtyDispatcher {
    return new PtyDispatcher(pty, {
      ...DEFAULT_DISPATCHER_CONFIG,
      dialPresets: this.profile.options.dialCommands,
    });
  }

  snapshot(): DaemonSnapshot {
    return {
      controller: this.controller,
      feedback: this.renderer.frame(),
      mode: this.engine.mode,
      sessions: this.opts.backend === 'sdk' ? this.sessions.list() : [],
      activeSessionSlot: this.sessions.activeSlot,
      agentState:
        this.opts.backend === 'sdk' ? this.sessions.activeState : this.stateMachine.state,
      profileName: this.profile.name,
      backend: this.opts.backend,
      pendingPermission: this.pendingPermissionDetail,
    };
  }

  getPalette(): PaletteState {
    return this.palette;
  }

  setMode(mode: ModeName): void {
    this.engine.setMode(mode);
  }

  private emitSnapshot(): void {
    this.emit('snapshot', this.snapshot());
  }

  log(line: string): void {
    this.opts.log(line);
    this.emit('log', { line });
  }
}

function isPaletteNavGesture(gesture: string): boolean {
  return [
    'dpadUp.press',
    'dpadDown.press',
    'lstick.up',
    'lstick.down',
    'cross.press',
    'circle.press',
    'square.press',
  ].includes(gesture);
}

export function loadProfile(profilePath: string): Profile {
  const raw = fs.readFileSync(profilePath, 'utf8');
  const res = safeParseProfile(JSON.parse(raw));
  if (!res.ok) {
    throw new Error(`invalid profile ${path.basename(profilePath)}:\n${res.error}`);
  }
  return res.profile;
}
