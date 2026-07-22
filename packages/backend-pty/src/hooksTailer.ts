import fs from 'node:fs';
import path from 'node:path';
import { TypedEmitter } from '@codesense/core';
import type { AgentEvent } from '@codesense/core';

export interface HooksTailerEvents extends Record<string, unknown> {
  event: AgentEvent;
  raw: Record<string, unknown>;
  error: { message: string };
}

/** Map Claude Code hook_event_name → normalized AgentEvent kind. */
const KIND_MAP: Record<string, AgentEvent['kind']> = {
  SessionStart: 'session-start',
  SessionEnd: 'session-end',
  UserPromptSubmit: 'prompt-submit',
  PreToolUse: 'pre-tool',
  PostToolUse: 'post-tool',
  PostToolUseFailure: 'tool-failure',
  PermissionRequest: 'permission-request',
  PermissionDenied: 'permission-resolved',
  Stop: 'stop',
  StopFailure: 'stop-failure',
  Notification: 'notification',
  PreCompact: 'compact',
  PostCompact: 'compact',
  SubagentStart: 'subagent-start',
  SubagentStop: 'subagent-end',
  // background task finished → same "glance-free" haptic as Notification
  TaskCompleted: 'notification',
};

export function defaultEventsFile(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '.';
  return path.join(home, '.codesense', 'events.jsonl');
}

/**
 * Tails ~/.codesense/events.jsonl, which Claude Code hooks append to.
 * Uses fs.watch plus a polling fallback (fs.watch on Windows can miss
 * appends from other processes under load).
 */
export class HooksTailer extends TypedEmitter<HooksTailerEvents> {
  private file: string;
  private offset = 0;
  private watcher: fs.FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reading = false;
  private pendingPartial = '';

  constructor(file = defaultEventsFile()) {
    super();
    this.file = file;
  }

  get filePath(): string {
    return this.file;
  }

  start(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '');
    // start at end of file — history is not replayed
    this.offset = fs.statSync(this.file).size;

    try {
      this.watcher = fs.watch(this.file, () => this.drain());
    } catch {
      // watch can fail on some file systems; polling still covers us
    }
    this.pollTimer = setInterval(() => this.drain(), 250);
    this.pollTimer.unref?.();
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private drain(): void {
    if (this.reading) return;
    this.reading = true;
    try {
      const stat = fs.statSync(this.file);
      if (stat.size < this.offset) {
        // file truncated/rotated — restart from beginning
        this.offset = 0;
        this.pendingPartial = '';
      }
      if (stat.size === this.offset) return;
      const fd = fs.openSync(this.file, 'r');
      try {
        const len = stat.size - this.offset;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, this.offset);
        this.offset = stat.size;
        this.ingestChunk(buf.toString('utf8'));
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      this.emit('error', { message: String(err) });
    } finally {
      this.reading = false;
    }
  }

  private ingestChunk(chunk: string): void {
    const text = this.pendingPartial + chunk;
    const lines = text.split(/\r?\n/);
    this.pendingPartial = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.replace(/^﻿/, '').trim();
      if (!trimmed) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue; // partial or corrupt line — skip quietly
      }
      this.emit('raw', parsed);
      const event = normalizeHookEvent(parsed);
      if (event) this.emit('event', event);
    }
  }
}

export function normalizeHookEvent(
  parsed: Record<string, unknown>,
): AgentEvent | null {
  const name = parsed['hook_event_name'];
  if (typeof name !== 'string') return null;
  const kind = KIND_MAP[name];
  if (!kind) return null;
  const toolName =
    typeof parsed['tool_name'] === 'string' ? parsed['tool_name'] : undefined;
  const sessionId =
    typeof parsed['session_id'] === 'string' ? parsed['session_id'] : undefined;
  const detail =
    typeof parsed['message'] === 'string'
      ? parsed['message']
      : typeof parsed['stop_reason'] === 'string'
        ? parsed['stop_reason']
        : undefined;
  return { kind, toolName, sessionId, detail, timestamp: Date.now() };
}
