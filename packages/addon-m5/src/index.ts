#!/usr/bin/env node
/**
 * codesense-m5 — the CoreS3 addon bridge.
 *
 *   codesense-m5                 connect to a local daemon, serve the emulator
 *   codesense-m5 --demo          no daemon: cycle a synthetic state (UI dev)
 *   codesense-m5 --token abc123  require a device token (LAN auth)
 *
 * Run the daemon separately (e.g. `node packages/cli/dist/index.js start --mock`)
 * — this process never touches the daemon's code, only its ws.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Bridge } from './bridge.js';
import type { PresetDef } from './bridge.js';
import { WsTransport } from './transports/wsTransport.js';

interface Args {
  daemon: string;
  port: number;
  host: string;
  token?: string;
  demo: boolean;
  emulator: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    daemon: 'ws://127.0.0.1:3737/ws',
    port: 3838,
    host: '127.0.0.1',
    demo: false,
    emulator: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--daemon':
        a.daemon = argv[++i] ?? a.daemon;
        break;
      case '--port':
        a.port = Number(argv[++i] ?? a.port);
        break;
      case '--host':
        a.host = argv[++i] ?? a.host;
        break;
      case '--token':
        a.token = argv[++i];
        break;
      case '--demo':
        a.demo = true;
        break;
      case '--no-emulator':
        a.emulator = false;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
    }
  }
  return a;
}

function printHelp(): void {
  process.stdout.write(
    [
      'codesense-m5 — M5Stack CoreS3 addon bridge',
      '',
      'Options:',
      '  --daemon <url>   daemon ws url (default ws://127.0.0.1:3737/ws)',
      '  --port <n>       device/emulator port (default 3838)',
      '  --host <addr>    bind address (default 127.0.0.1; use 0.0.0.0 for LAN)',
      '  --token <str>    require devices to authenticate with this token',
      '  --demo           synthesize a cycling state; do not connect to a daemon',
      '  --no-emulator    do not serve the browser emulator',
      '',
    ].join('\n'),
  );
}

function findEmulatorDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../emulator'), // dist/index.js → ../emulator
    path.resolve(here, 'emulator'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return null;
}

const DEFAULT_PRESETS: PresetDef[] = [
  { id: 'tests', label: 'run tests', text: 'run the tests' },
  { id: 'explain', label: 'explain this', text: 'explain what this code does' },
  { id: 'commit', label: 'commit', text: 'commit the current changes with a clear message' },
];

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const log = (line: string): void => {
    process.stdout.write(`[m5] ${line}\n`);
  };

  const staticDir = args.emulator ? findEmulatorDir() : null;
  if (args.emulator && !staticDir) log('emulator dir not found — serving ws only');

  const ws = new WsTransport({
    port: args.port,
    host: args.host,
    token: args.token,
    staticDir,
    log,
  });

  const bridge = new Bridge({
    daemonUrl: args.daemon,
    transports: [ws],
    presets: DEFAULT_PRESETS,
    demo: args.demo,
    log,
  });

  bridge.start();

  if (staticDir) log(`emulator → http://${args.host}:${args.port}/`);
  if (args.token) log('device token required (send {"t":"hello","token":…})');

  const shutdown = (): void => {
    log('shutting down');
    bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
