#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { installHooks, uninstallHooks, userSettingsPath } from '@codesense/backend-pty';
import { safeParseProfile } from '@codesense/core';
import { Daemon } from './daemon.js';
import { startServer } from './server.js';
import { runDoctor } from './doctor.js';
import { banner, icon, kv } from './ui.js';

const VERSION = '0.1.0';
const DEFAULT_PORT = 3737;

function findDefaultProfile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const userProfile = path.join(os.homedir(), '.codesense', 'profiles', 'default.json');
  if (fs.existsSync(userProfile)) return userProfile;
  const candidates = [
    path.resolve(here, '../../../profiles/default.json'), // monorepo: packages/cli/dist → profiles/
    path.resolve(here, '../profiles/default.json'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('no profile found — pass --profile <path>');
}

interface StartFlags {
  mock: boolean;
  backend: 'pty' | 'sdk';
  port: number;
  dashboard: boolean;
  profile: string | null;
  brightness: number;
  haptics: boolean;
  triggers: boolean;
  bt: boolean;
  claudeArgs: string[];
}

function parseStartFlags(args: string[]): StartFlags {
  const flags: StartFlags = {
    mock: false,
    backend: 'pty',
    port: DEFAULT_PORT,
    dashboard: true,
    profile: null,
    brightness: 1,
    haptics: true,
    triggers: true,
    bt: false,
    claudeArgs: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    switch (a) {
      case '--mock': flags.mock = true; break;
      case '--backend': flags.backend = args[++i] === 'sdk' ? 'sdk' : 'pty'; break;
      case '--port': flags.port = Number(args[++i]) || DEFAULT_PORT; break;
      case '--no-dashboard': flags.dashboard = false; break;
      case '--profile': flags.profile = args[++i] ?? null; break;
      case '--brightness': flags.brightness = Math.max(0.1, Math.min(1, Number(args[++i]) || 1)); break;
      case '--no-haptics': flags.haptics = false; break;
      case '--no-triggers': flags.triggers = false; break;
      case '--experimental-bt': flags.bt = true; break;
      case '--': flags.claudeArgs = args.slice(i + 1); i = args.length; break;
      default:
        console.error(pc.red(`unknown flag ${a}`));
        process.exit(1);
    }
  }
  return flags;
}

async function cmdStart(args: string[]): Promise<void> {
  const flags = parseStartFlags(args);
  const profilePath = flags.profile ?? findDefaultProfile();

  const logDir = path.join(os.homedir(), '.codesense');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'daemon.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  const ptyMode = flags.backend === 'pty';
  const log = (line: string): void => {
    logStream.write(`${new Date().toISOString()} ${line}\n`);
    // in sdk mode the terminal is ours; in pty mode it belongs to claude
    if (!ptyMode) console.log(`${icon.dot} ${line}`);
  };

  console.log(banner(VERSION));
  console.log(kv('backend', flags.backend + (flags.mock ? ' · mock controller' : '')));
  console.log(kv('profile', path.basename(profilePath)));
  if (!flags.bt) console.log(kv('transport', 'usb (add --experimental-bt for bluetooth)'));

  const daemon = new Daemon({
    backend: flags.backend,
    mock: flags.mock,
    profilePath,
    cwd: process.cwd(),
    brightness: flags.brightness,
    haptics: flags.haptics,
    adaptiveTriggers: flags.triggers,
    claudeCommand: 'claude',
    claudeArgs: flags.claudeArgs,
    experimentalBt: flags.bt,
    log,
  });

  if (flags.dashboard) {
    startServer(daemon, flags.port);
    console.log(kv('dashboard', pc.blue(`http://localhost:${flags.port}`)));
  }
  console.log(kv('log', logFile));
  console.log();

  daemon.start();

  if (ptyMode && daemon.pty) {
    // hand this terminal over to claude, controller writes into the same pty
    const pty = daemon.pty;
    pty.on('data', (data) => process.stdout.write(data));
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (d: Buffer) => pty.write(d.toString('utf8')));
    process.stdout.on('resize', () => {
      pty.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 30);
    });
    daemon.on('pty-exit', ({ exitCode }) => {
      daemon.stop();
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.exit(exitCode);
    });
  } else {
    console.log(pc.dim('sdk backend running — open the dashboard to start sessions. ctrl+c to quit.'));
  }

  const shutdown = (): void => {
    daemon.stop();
    if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(false);
    process.exit(0);
  };
  process.on('SIGINT', ptyMode ? () => {} : shutdown); // pty mode: Ctrl+C belongs to claude
  process.on('SIGTERM', shutdown);
}

function cmdHooks(args: string[]): void {
  const sub = args[0];
  if (sub === 'install') {
    const { installed, settingsFile } = installHooks();
    console.log(`${icon.ok} hooks installed for ${installed.length} events`);
    console.log(kv('settings', settingsFile));
    console.log(pc.dim('restart any running claude sessions to pick them up'));
  } else if (sub === 'uninstall') {
    const changed = uninstallHooks();
    console.log(changed ? `${icon.ok} hooks removed` : `${icon.info} no codesense hooks found`);
  } else {
    console.log(`usage: codesense hooks <install|uninstall>`);
    console.log(kv('settings', userSettingsPath()));
  }
}

function cmdProfiles(args: string[]): void {
  const sub = args[0];
  if (sub === 'validate') {
    const file = args[1] ?? findDefaultProfile();
    const res = safeParseProfile(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (res.ok) {
      console.log(`${icon.ok} ${path.basename(file)} — valid profile "${res.profile.name}"`);
    } else {
      console.log(`${icon.err} ${path.basename(file)} is invalid:\n${res.error}`);
      process.exitCode = 1;
    }
  } else {
    console.log('usage: codesense profiles validate [file]');
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case undefined:
    case 'start':
      await cmdStart(rest);
      break;
    case 'doctor':
      process.exitCode = await runDoctor();
      break;
    case 'test': {
      const { runTestPattern } = await import('./testPattern.js');
      process.exitCode = await runTestPattern(rest.includes('--experimental-bt'));
      break;
    }
    case 'hooks':
      cmdHooks(rest);
      break;
    case 'profiles':
      cmdProfiles(rest);
      break;
    case '--version':
    case 'version':
      console.log(VERSION);
      break;
    default:
      console.log(banner(VERSION));
      console.log(`
usage: codesense <command>

  start [flags]      wrap claude with controller superpowers (default)
    --mock              virtual controller (no hardware needed)
    --backend pty|sdk   terminal wrapper (default) or Agent SDK sessions
    --port <n>          dashboard port (default ${DEFAULT_PORT})
    --no-dashboard      don't serve the web dashboard
    --profile <file>    mapping profile (default: profiles/default.json)
    --brightness <0-1>  lightbar brightness
    --no-haptics        disable rumble feedback
    --no-triggers       disable adaptive trigger effects
    --experimental-bt   allow bluetooth transport
    -- <args>           extra args passed to claude
  doctor             environment + hardware checks
  test               hardware smoke test: lightbar, LEDs, rumble, R2 resistance
  hooks install      wire Claude Code hooks into ~/.claude/settings.json
  hooks uninstall    remove them
  profiles validate  check a profile file
`);
  }
}

main().catch((err) => {
  console.error(pc.red(String(err)));
  process.exit(1);
});
