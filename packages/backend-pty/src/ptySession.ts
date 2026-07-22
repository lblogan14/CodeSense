import fs from 'node:fs';
import path from 'node:path';
import * as pty from 'node-pty';
import { TypedEmitter } from '@codesense/core';

/**
 * ConPTY does not search PATH ("File not found"), so resolve the command
 * to an absolute path the way the shell would: each PATH entry × each
 * PATHEXT extension. Returns the file to spawn plus prefix args (a .cmd
 * or .bat must run under cmd.exe /c).
 */
export function resolveCommand(
  command: string,
  env: Record<string, string | undefined> = process.env,
): { file: string; prefixArgs: string[] } {
  const wrap = (file: string): { file: string; prefixArgs: string[] } => {
    const ext = path.extname(file).toLowerCase();
    if (process.platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
      return {
        file: path.join(env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'cmd.exe'),
        prefixArgs: ['/c', file],
      };
    }
    return { file, prefixArgs: [] };
  };

  if (command.includes('/') || command.includes('\\')) return wrap(command);
  if (process.platform !== 'win32') return { file: command, prefixArgs: [] };

  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(';').filter(Boolean);
  const exts = (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const hasExt = path.extname(command) !== '';
  for (const dir of dirs) {
    if (hasExt) {
      const full = path.join(dir, command);
      if (fs.existsSync(full)) return wrap(full);
    }
    for (const ext of exts) {
      const full = path.join(dir, command + ext.toLowerCase());
      if (fs.existsSync(full)) return wrap(full);
    }
  }
  // let ConPTY produce its own error for truly missing commands
  return { file: command, prefixArgs: [] };
}

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
    const resolved = resolveCommand(command, env);
    try {
      this.proc = this.spawn(resolved, env);
    } catch (err) {
      throw new Error(
        `could not start "${command}" (resolved to "${resolved.file}"): ${String(err)} — is it installed and on PATH?`,
      );
    }
    this.proc.onData((data) => this.emit('data', data));
    this.proc.onExit(({ exitCode }) => {
      this.proc = null;
      this.emit('exit', { exitCode });
    });
  }

  private spawn(
    resolved: { file: string; prefixArgs: string[] },
    env: Record<string, string>,
  ): pty.IPty {
    return pty.spawn(resolved.file, [...resolved.prefixArgs, ...(this.opts.args ?? [])], {
      name: 'xterm-256color',
      cols: this.opts.cols ?? process.stdout.columns ?? 120,
      rows: this.opts.rows ?? process.stdout.rows ?? 30,
      cwd: this.opts.cwd ?? process.cwd(),
      env,
      useConpty: true,
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
