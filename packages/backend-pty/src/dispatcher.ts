import type { Action } from '@codesense/core';
import type { PtySession } from './ptySession.js';

const ESC = '\u001b';

export interface DispatcherConfig {
  /** keystrokes that select "approve once" in a permission dialog */
  approveOnceKeys: string;
  /** keystrokes that select "always allow" in a permission dialog */
  approveAlwaysKeys: string;
  rejectKeys: string;
  interruptKeys: string;
  /**
   * reasoning-dial presets, dialed with rstick up/down in AGENT mode.
   * Each entry is typed followed by Enter.
   */
  dialPresets: string[];
}

export const DEFAULT_DISPATCHER_CONFIG: DispatcherConfig = {
  approveOnceKeys: '\r', // default highlighted option = Yes
  approveAlwaysKeys: `${ESC}[B\r`, // down to "always allow", then Enter
  rejectKeys: ESC, // Esc closes the dialog / rejects
  interruptKeys: ESC,
  dialPresets: ['/model haiku', '/model sonnet', '/model opus'],
};

/**
 * Turns mapping-engine Actions into pty keystrokes for the interactive
 * Claude Code CLI. Session/palette actions are handled a level up (the
 * daemon) — this dispatcher reports whether it consumed the action.
 */
export class PtyDispatcher {
  private dialIndex = 1; // start at the middle preset
  constructor(
    private session: PtySession,
    private config: DispatcherConfig = DEFAULT_DISPATCHER_CONFIG,
  ) {}

  /** current dial position (for dashboard display) */
  get dial(): { index: number; presets: string[] } {
    return { index: this.dialIndex, presets: this.config.dialPresets };
  }

  async dispatch(action: Action): Promise<boolean> {
    switch (action.type) {
      case 'keys':
        this.session.write(action.keys);
        return true;
      case 'text':
        await this.session.type(action.text);
        return true;
      case 'slash':
        // Esc first clears any half-typed input so the command lands clean
        this.session.write(ESC);
        await delay(60);
        await this.session.type(action.command);
        await delay(120); // let the slash menu settle on the exact match
        this.session.write('\r');
        return true;
      case 'approve':
        this.session.write(
          action.scope === 'always'
            ? this.config.approveAlwaysKeys
            : this.config.approveOnceKeys,
        );
        return true;
      case 'reject':
        this.session.write(this.config.rejectKeys);
        return true;
      case 'interrupt':
        this.session.write(this.config.interruptKeys);
        return true;
      case 'dial': {
        const next =
          this.dialIndex + (action.direction === 'up' ? 1 : -1);
        this.dialIndex = Math.min(
          this.config.dialPresets.length - 1,
          Math.max(0, next),
        );
        const preset = this.config.dialPresets[this.dialIndex]!;
        this.session.write(ESC);
        await delay(60);
        await this.session.type(preset);
        await delay(120);
        this.session.write('\r');
        return true;
      }
      case 'voice':
        if (action.action === 'toggle') {
          this.session.write(ESC);
          await delay(60);
          await this.session.type('/voice');
          await delay(120);
          this.session.write('\r');
        } else {
          // push-to-talk: Space is Claude Code's voice key (tap mode)
          this.session.write(' ');
        }
        return true;
      case 'noop':
        return true;
      // handled by the daemon:
      case 'mode':
      case 'session':
      case 'palette':
      case 'macro':
      case 'replay-status':
        return false;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
