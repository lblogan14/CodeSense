import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultEventsFile } from './hooksTailer.js';

/** Hook events CodeSense listens to for the controller state display. */
export const CODESENSE_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'Stop',
  'StopFailure',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'SubagentComplete',
] as const;

const MARKER = 'codesense-events';

interface HookCommand {
  type: 'command';
  command: string;
  args?: string[];
  timeout?: number;
}

interface HookMatcherEntry {
  matcher?: string;
  hooks: HookCommand[];
}

/**
 * Builds the hook command that appends the event JSON (stdin) to
 * ~/.codesense/events.jsonl. Uses Node (always present where CodeSense
 * runs) so the same command works regardless of the configured shell.
 */
export function buildHookCommand(eventsFile = defaultEventsFile()): HookCommand {
  const script = [
    `const fs=require('fs'),p=${JSON.stringify(eventsFile)};`,
    `let d='';process.stdin.on('data',c=>d+=c);`,
    `process.stdin.on('end',()=>{try{fs.mkdirSync(require('path').dirname(p),{recursive:true});`,
    `fs.appendFileSync(p,JSON.stringify(JSON.parse(d))+'\\n');}catch{}});`,
  ].join('');
  return {
    type: 'command',
    command: process.execPath, // absolute node path — immune to PATH issues
    args: ['-e', script],
    timeout: 10,
  };
}

export function userSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

/**
 * Idempotently merges CodeSense hooks into a Claude Code settings file.
 * Existing user hooks are preserved; previous CodeSense entries (matched
 * by marker in the args) are replaced.
 */
export function installHooks(
  settingsFile = userSettingsPath(),
  eventsFile = defaultEventsFile(),
): { installed: string[]; settingsFile: string } {
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsFile)) {
    const raw = fs.readFileSync(settingsFile, 'utf8').trim();
    if (raw) settings = JSON.parse(raw) as Record<string, unknown>;
  }
  const hooks = (settings['hooks'] ?? {}) as Record<string, HookMatcherEntry[]>;
  const command = buildHookCommand(eventsFile);
  // marker travels inside the script so we can find & replace our entries
  command.args = [command.args![0]!, `/*${MARKER}*/` + command.args![1]!];

  const installed: string[] = [];
  for (const event of CODESENSE_HOOK_EVENTS) {
    const entries: HookMatcherEntry[] = Array.isArray(hooks[event])
      ? hooks[event]!
      : [];
    const kept = entries.filter(
      (e) => !e.hooks?.some((h) => h.args?.some((a) => a.includes(MARKER))),
    );
    kept.push({ matcher: '*', hooks: [command] });
    hooks[event] = kept;
    installed.push(event);
  }
  settings['hooks'] = hooks;
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  return { installed, settingsFile };
}

/** Removes CodeSense hook entries. */
export function uninstallHooks(settingsFile = userSettingsPath()): boolean {
  if (!fs.existsSync(settingsFile)) return false;
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<
    string,
    unknown
  >;
  const hooks = settings['hooks'] as
    | Record<string, HookMatcherEntry[]>
    | undefined;
  if (!hooks) return false;
  let changed = false;
  for (const event of Object.keys(hooks)) {
    const entries = hooks[event]!;
    const kept = entries.filter(
      (e) => !e.hooks?.some((h) => h.args?.some((a) => a.includes(MARKER))),
    );
    if (kept.length !== entries.length) changed = true;
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  if (changed) {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  }
  return changed;
}

/** True if CodeSense hooks are present in the settings file. */
export function hooksInstalled(settingsFile = userSettingsPath()): boolean {
  if (!fs.existsSync(settingsFile)) return false;
  try {
    return fs.readFileSync(settingsFile, 'utf8').includes(MARKER);
  } catch {
    return false;
  }
}
