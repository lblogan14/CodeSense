import { query } from '@anthropic-ai/claude-agent-sdk';
import { TypedEmitter } from '@codesense/core';
import type { AgentEvent } from '@codesense/core';

export interface PendingPermission {
  id: number;
  toolName: string;
  input: Record<string, unknown>;
  requestedAt: number;
}

export interface SdkSessionEvents extends Record<string, unknown> {
  event: AgentEvent;
  text: { text: string };
  permission: PendingPermission;
  'permission-cleared': { id: number };
  result: { result: string; costUsd?: number };
  status: { running: boolean };
  error: { message: string };
}

interface PermissionResolver {
  pending: PendingPermission;
  resolve: (decision: 'once' | 'always' | 'deny') => void;
}

interface QueuedPrompt {
  text: string;
}

/**
 * One daemon-owned Claude session. Prompts are pushed in over time
 * (streaming-input mode); permission requests surface as events and are
 * resolved by the controller (R2 pull) or the dashboard.
 */
export class SdkSession extends TypedEmitter<SdkSessionEvents> {
  readonly slot: number;
  cwd: string;
  label: string;
  private promptQueue: QueuedPrompt[] = [];
  private wakeQueue: (() => void) | null = null;
  private closed = false;
  private running = false;
  private permissionSeq = 0;
  private permission: PermissionResolver | null = null;
  private transcript: { role: string; text: string }[] = [];
  private _costUsd = 0;

  constructor(slot: number, cwd: string, label?: string) {
    super();
    this.slot = slot;
    this.cwd = cwd;
    this.label = label ?? `session ${slot}`;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get pendingPermission(): PendingPermission | null {
    return this.permission?.pending ?? null;
  }

  /** cumulative cost across all turns of this session */
  get costUsd(): number {
    return this._costUsd;
  }

  getTranscript(): { role: string; text: string }[] {
    return this.transcript;
  }

  /** Queue a user prompt; starts the session loop on first use. */
  prompt(text: string): void {
    this.transcript.push({ role: 'user', text });
    this.promptQueue.push({ text });
    this.wakeQueue?.();
    if (!this.running) void this.run();
  }

  /** Resolve the pending permission from the controller. */
  resolvePermission(decision: 'once' | 'always' | 'deny'): boolean {
    if (!this.permission) return false;
    const { pending, resolve } = this.permission;
    this.permission = null;
    this.emit('permission-cleared', { id: pending.id });
    this.emit('event', {
      kind: 'permission-resolved',
      toolName: pending.toolName,
      timestamp: Date.now(),
    });
    resolve(decision);
    return true;
  }

  close(): void {
    this.closed = true;
    this.permission?.resolve('deny');
    this.permission = null;
    this.wakeQueue?.();
  }

  // ── internals ────────────────────────────────────────────────

  private async *userMessages(): AsyncGenerator<{
    type: 'user';
    message: { role: 'user'; content: string };
    parent_tool_use_id: null;
    session_id: string;
  }> {
    while (!this.closed) {
      const next = this.promptQueue.shift();
      if (next) {
        this.emit('event', { kind: 'prompt-submit', timestamp: Date.now() });
        yield {
          type: 'user',
          message: { role: 'user', content: next.text },
          parent_tool_use_id: null,
          session_id: '',
        };
        continue;
      }
      await new Promise<void>((r) => (this.wakeQueue = r));
      this.wakeQueue = null;
    }
  }

  private async run(): Promise<void> {
    this.running = true;
    this.emit('status', { running: true });
    this.emit('event', { kind: 'session-start', timestamp: Date.now() });
    try {
      const response = query({
        prompt: this.userMessages() as never,
        options: {
          cwd: this.cwd,
          canUseTool: async (
            toolName: string,
            input: Record<string, unknown>,
            { suggestions }: { suggestions?: unknown[] } = {},
          ) => {
            const pending: PendingPermission = {
              id: ++this.permissionSeq,
              toolName,
              input,
              requestedAt: Date.now(),
            };
            this.emit('event', {
              kind: 'permission-request',
              toolName,
              timestamp: Date.now(),
            });
            this.emit('permission', pending);
            const decision = await new Promise<'once' | 'always' | 'deny'>(
              (resolve) => {
                this.permission = { pending, resolve };
              },
            );
            if (decision === 'deny') {
              return {
                behavior: 'deny' as const,
                message: 'Rejected from the controller',
              };
            }
            if (decision === 'always' && suggestions?.length) {
              return {
                behavior: 'allow' as const,
                updatedInput: input,
                updatedPermissions: suggestions as never[],
              };
            }
            return { behavior: 'allow' as const, updatedInput: input };
          },
        },
      });

      for await (const message of response as AsyncIterable<Record<string, unknown>>) {
        if (this.closed) break;
        this.handleMessage(message);
      }
    } catch (err) {
      this.emit('event', { kind: 'stop-failure', detail: String(err), timestamp: Date.now() });
      this.emit('error', { message: String(err) });
    } finally {
      this.running = false;
      this.emit('status', { running: false });
      this.emit('event', { kind: 'session-end', timestamp: Date.now() });
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    const type = message['type'];
    if (type === 'assistant') {
      const msg = message['message'] as
        | { content?: { type: string; text?: string; name?: string }[] }
        | undefined;
      const blocks = msg?.content ?? [];
      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          this.transcript.push({ role: 'assistant', text: block.text });
          this.emit('text', { text: block.text });
        } else if (block.type === 'tool_use') {
          this.emit('event', {
            kind: 'pre-tool',
            toolName: block.name,
            timestamp: Date.now(),
          });
        }
      }
    } else if (type === 'result') {
      const subtype = message['subtype'];
      const resultText =
        typeof message['result'] === 'string' ? message['result'] : '';
      const costUsd =
        typeof message['total_cost_usd'] === 'number'
          ? message['total_cost_usd']
          : undefined;
      if (costUsd != null) this._costUsd = costUsd;
      if (subtype === 'success') {
        this.emit('event', { kind: 'stop', timestamp: Date.now() });
      } else {
        this.emit('event', {
          kind: 'stop-failure',
          detail: String(subtype),
          timestamp: Date.now(),
        });
      }
      this.emit('result', { result: resultText, costUsd });
    } else if (type === 'system') {
      // init / status messages — session is alive and thinking
      this.emit('event', { kind: 'notification', timestamp: Date.now() });
    }
  }
}
