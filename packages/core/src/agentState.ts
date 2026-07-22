import { TypedEmitter } from './bus.js';
import type { AgentEvent, AgentStateName } from './types.js';

export interface AgentStateEvents extends Record<string, unknown> {
  change: { state: AgentStateName; previous: AgentStateName; event?: AgentEvent };
}

/**
 * Agent state machine. Ingests normalized AgentEvents (from the hooks
 * tailer or the SDK backend) and exposes the current display state.
 *
 * "done" is transient: after doneHoldMs it decays to "idle".
 * "error" decays to "idle" after errorHoldMs (the flash is the signal;
 * a stuck red bar reads as broken).
 */
export class AgentStateMachine extends TypedEmitter<AgentStateEvents> {
  private _state: AgentStateName = 'disconnected';
  private decayTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingPermissions = 0;

  constructor(
    private opts: { doneHoldMs?: number; errorHoldMs?: number } = {},
  ) {
    super();
  }

  get state(): AgentStateName {
    return this._state;
  }

  ingest(event: AgentEvent): void {
    switch (event.kind) {
      case 'session-start':
        this.pendingPermissions = 0;
        this.transition('idle', event);
        break;
      case 'session-end':
        this.pendingPermissions = 0;
        this.transition('disconnected', event);
        break;
      case 'prompt-submit':
      case 'pre-tool':
      case 'compact':
        // A new prompt or tool activity supersedes done/error/permission display
        if (this._state !== 'permission' || event.kind === 'prompt-submit') {
          this.pendingPermissions = 0;
          this.transition('thinking', event);
        }
        break;
      case 'post-tool':
        if (this._state !== 'permission') this.transition('thinking', event);
        break;
      case 'permission-request':
        this.pendingPermissions += 1;
        this.transition('permission', event);
        break;
      case 'permission-resolved':
        this.pendingPermissions = Math.max(0, this.pendingPermissions - 1);
        if (this.pendingPermissions === 0 && this._state === 'permission') {
          this.transition('thinking', event);
        }
        break;
      case 'stop':
        this.pendingPermissions = 0;
        this.transition('done', event);
        this.scheduleDecay(this.opts.doneHoldMs ?? 3000);
        break;
      case 'stop-failure':
      case 'tool-failure':
        this.transition('error', event);
        this.scheduleDecay(this.opts.errorHoldMs ?? 4000);
        break;
      case 'notification':
      case 'subagent-start':
      case 'subagent-end':
        // No display-state change: Notification means a background task or
        // subagent event (the daemon turns it into a haptic tap), and
        // permission waits are signaled by PermissionRequest explicitly.
        break;
    }
  }

  /** Force a state (used when controller/backend connects or disconnects). */
  set(state: AgentStateName): void {
    this.transition(state);
  }

  private scheduleDecay(ms: number): void {
    if (this.decayTimer) clearTimeout(this.decayTimer);
    const from = this._state;
    this.decayTimer = setTimeout(() => {
      if (this._state === from) this.transition('idle');
    }, ms);
    // Do not keep the process alive just for a decay animation
    this.decayTimer.unref?.();
  }

  private transition(next: AgentStateName, event?: AgentEvent): void {
    if (next === this._state) return;
    if (this.decayTimer && next !== 'done' && next !== 'error') {
      clearTimeout(this.decayTimer);
      this.decayTimer = undefined;
    }
    const previous = this._state;
    this._state = next;
    this.emit('change', { state: next, previous, event });
  }
}
