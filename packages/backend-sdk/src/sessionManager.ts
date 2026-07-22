import { AgentStateMachine, TypedEmitter } from '@codesense/core';
import type { AgentEvent, AgentStateName, SessionInfo } from '@codesense/core';
import { SdkSession } from './sdkSession.js';
import type { PendingPermission } from './sdkSession.js';

export interface SessionManagerEvents extends Record<string, unknown> {
  /** state change of the ACTIVE session (drives the lightbar) */
  'active-state': { state: AgentStateName; slot: number };
  'active-changed': { slot: number };
  sessions: { sessions: SessionInfo[] };
  permission: { slot: number; pending: PendingPermission };
  event: { slot: number; event: AgentEvent };
  text: { slot: number; text: string };
}

const MAX_SESSIONS = 4;

/**
 * Owns up to 4 SDK sessions mapped to controller slots 1..4 (player
 * LEDs). L1/R1 switch the active slot; the lightbar shows the active
 * session's state; a permission request on ANY session pulses haptics.
 */
export class SessionManager extends TypedEmitter<SessionManagerEvents> {
  private sessions = new Map<number, { session: SdkSession; machine: AgentStateMachine }>();
  private _activeSlot = 1;

  get activeSlot(): number {
    return this._activeSlot;
  }

  get activeSession(): SdkSession | null {
    return this.sessions.get(this._activeSlot)?.session ?? null;
  }

  get activeState(): AgentStateName {
    // an empty slot is "idle": ready for a session, not broken
    return this.sessions.get(this._activeSlot)?.machine.state ?? 'idle';
  }

  list(): SessionInfo[] {
    return [...this.sessions.entries()].map(([slot, s]) => ({
      id: String(slot),
      slot,
      cwd: s.session.cwd,
      state: s.machine.state,
      lastEventAt: Date.now(),
      label: s.session.label,
    }));
  }

  /** Create (or reuse) the session in a slot and send it a prompt. */
  prompt(slot: number, cwd: string, text: string, label?: string): SdkSession {
    let entry = this.sessions.get(slot);
    if (!entry) {
      if (this.sessions.size >= MAX_SESSIONS && !this.sessions.has(slot)) {
        throw new Error(`all ${MAX_SESSIONS} session slots in use`);
      }
      const session = new SdkSession(slot, cwd, label);
      const machine = new AgentStateMachine();
      machine.on('change', ({ state }) => {
        if (slot === this._activeSlot) {
          this.emit('active-state', { state, slot });
        }
        this.emit('sessions', { sessions: this.list() });
      });
      session.on('event', (event) => {
        machine.ingest(event);
        this.emit('event', { slot, event });
      });
      session.on('permission', (pending) => {
        this.emit('permission', { slot, pending });
      });
      session.on('text', ({ text: t }) => this.emit('text', { slot, text: t }));
      entry = { session, machine };
      this.sessions.set(slot, entry);
    }
    entry.session.prompt(text);
    this.emit('sessions', { sessions: this.list() });
    return entry.session;
  }

  setActive(slot: number): void {
    if (slot < 1 || slot > MAX_SESSIONS) return;
    this._activeSlot = slot;
    this.emit('active-changed', { slot });
    this.emit('active-state', { state: this.activeState, slot });
  }

  cycle(direction: 'next' | 'prev'): void {
    const delta = direction === 'next' ? 1 : -1;
    let slot = this._activeSlot;
    slot = ((slot - 1 + delta + MAX_SESSIONS) % MAX_SESSIONS) + 1;
    this.setActive(slot);
  }

  /** Resolve the active session's pending permission (R2 pull). */
  resolveActivePermission(decision: 'once' | 'always' | 'deny'): boolean {
    return this.activeSession?.resolvePermission(decision) ?? false;
  }

  /** Any session (not just active) awaiting permission? For LED blink. */
  slotsAwaitingPermission(): number[] {
    return [...this.sessions.entries()]
      .filter(([, s]) => s.machine.state === 'permission')
      .map(([slot]) => slot);
  }

  closeAll(): void {
    for (const { session } of this.sessions.values()) session.close();
    this.sessions.clear();
  }
}
