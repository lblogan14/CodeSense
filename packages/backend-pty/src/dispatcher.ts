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
  dialPresets: ['/effort low', '/effort medium', '/effort high', '/effort xhigh', '/effort max'],
};

/** interval between injected Space chars while push-to-talk is held —
 * fast enough to read as key-repeat to Claude Code's hold-mode voice */
const PTT_REPEAT_MS = 35;

/**
 * Turns mapping-engine Actions into pty keystrokes for the interactive
 * Claude Code CLI. Session/palette actions are handled a level up (the
 * daemon) — this dispatcher reports whether it consumed the action.
 */
export class PtyDispatcher {
  private dialIndex: number;
  private pttTimer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private session: PtySession,
    private config: DispatcherConfig = DEFAULT_DISPATCHER_CONFIG,
  ) {
    this.dialIndex = Math.floor((config.dialPresets.length - 1) / 2);
  }

  /** current dial position (for dashboard display + lightbar flash) */
  get dial(): { index: number; presets: string[] } {
    return { index: this.dialIndex, presets: this.config.dialPresets };
  }

  /** stop background streams (call on shutdown) */
  dispose(): void {
    this.stopPushToTalk();
  }

  private startPushToTalk(): void {
    if (this.pttTimer) return;
    // stream Space at key-repeat rate: Claude Code's hold-mode dictation
    // detects a held key by rapid repeats. The first 1-2 chars type into
    // the input and are auto-removed when recording activates.
    this.session.write(' ');
    this.pttTimer = setInterval(() => this.session.write(' '), PTT_REPEAT_MS);
  }

  private stopPushToTalk(): void {
    if (this.pttTimer) {
      clearInterval(this.pttTimer);
      this.pttTimer = null;
    }
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
        switch (action.action) {
          case 'toggle':
            this.stopPushToTalk();
            this.session.write(ESC);
            await delay(60);
            await this.session.type('/voice');
            await delay(120);
            this.session.write('\r');
            break;
          case 'pushStart':
            this.startPushToTalk();
            break;
          case 'pushEnd':
            this.stopPushToTalk();
            break;
          case 'push':
            // single tap: Claude Code's tap-mode voice key
            this.session.write(' ');
            break;
        }
        return true;
      case 'rewind':
        // Esc Esc with empty input opens the checkpoint menu; the pause
        // makes them read as two presses, not an escape sequence
        this.stopPushToTalk();
        this.session.write(ESC);
        await delay(150);
        this.session.write(ESC);
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
