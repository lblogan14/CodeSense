import * as pty from 'node-pty';
import { TypedEmitter } from '@codesense/core';

export interface PtySessionEvents extends Record<string, unknown> {
  data: string;
  exit: { exitCode: number };
}

export interface PtySessionOptions {
  /** command to run (default: "claude") */
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

/**
 * Wraps an interactive `claude` process in a pseudo-terminal (ConPTY on
 * Windows). The host terminal's stdin/stdout are proxied through, so the
 * user keeps their normal Claude Code experience — the controller just
 * writes into the same pty.
 */
export class PtySession extends TypedEmitter<PtySessionEvents> {
  private proc: pty.IPty | null = null;
  private opts: PtySessionOptions;

  constructor(opts: PtySessionOptions = {}) {
    super();
    this.opts = opts;
  }

  get running(): boolean {
    return this.proc !== null;
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  start(): void {
    if (this.proc) return;
    const command = this.opts.command ?? 'claude';
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...this.opts.env,
      CODESENSE: '1',
    };
    this.proc = pty.spawn(command, this.opts.args ?? [], {
      name: 'xterm-256color',
      cols: this.opts.cols ?? process.stdout.columns ?? 120,
      rows: this.opts.rows ?? process.stdout.rows ?? 30,
      cwd: this.opts.cwd ?? process.cwd(),
      env,
      useConpty: true,
    });
    this.proc.onData((data) => this.emit('data', data));
    this.proc.onExit(({ exitCode }) => {
      this.proc = null;
      this.emit('exit', { exitCode });
    });
  }

  /** Write raw bytes (keystrokes / escape sequences) into the pty. */
  write(data: string): void {
    this.proc?.write(data);
  }

  /**
   * Type text like a human: chunked so Claude Code's input handling and
   * slash-command menu keep up. Returns after the last chunk is queued.
   */
  async type(text: string, chunkDelayMs = 8): Promise<void> {
    for (const ch of text) {
      this.write(ch);
      if (chunkDelayMs > 0) await delay(chunkDelayMs);
    }
  }

  resize(cols: number, rows: number): void {
    try {
      this.proc?.resize(Math.max(cols, 20), Math.max(rows, 5));
    } catch {
      // resize can race process exit; ignore
    }
  }

  kill(): void {
    this.proc?.kill();
    this.proc = null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
