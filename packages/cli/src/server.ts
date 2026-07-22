import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { Daemon } from './daemon.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

/** Locate the built dashboard (works from the monorepo and when packaged). */
export function findDashboardDist(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../dashboard/dist'),
    path.resolve(here, '../dashboard'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return null;
}

type ClientMessage =
  | { type: 'sim-button'; button: string; down: boolean }
  | { type: 'sim-tap'; button: string }
  | { type: 'sim-stick'; which: 'left' | 'right'; x: number; y: number }
  | { type: 'sim-trigger'; which: 'l2' | 'r2'; value: number }
  | { type: 'sim-swipe'; direction: 'left' | 'right' | 'up' | 'down' }
  | { type: 'action'; action: unknown }
  | { type: 'set-mode'; mode: 'AGENT' | 'NAV' | 'PROMPT' }
  | { type: 'prompt'; slot?: number; text: string; cwd?: string }
  | { type: 'palette-select'; index: number }
  | { type: 'palette-confirm' }
  | { type: 'palette-close' }
  | { type: 'get-profile' }
  | { type: 'set-profile'; profile: unknown };

/**
 * Serves the dashboard (static) and a WebSocket at /ws streaming
 * snapshots/palette/log events and accepting control messages.
 */
export function startServer(daemon: Daemon, port: number): http.Server {
  const dist = findDashboardDist();

  const server = http.createServer((req, res) => {
    if (!dist) {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('dashboard not built — run: pnpm --filter @codesense/dashboard build');
      return;
    }
    const url = (req.url ?? '/').split('?')[0]!;
    let file = path.join(dist, url === '/' ? 'index.html' : url);
    if (!file.startsWith(dist)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(file)) file = path.join(dist, 'index.html'); // SPA fallback
    try {
      const body = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  const broadcast = (msg: unknown): void => {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  };

  daemon.on('snapshot', (snapshot) => broadcast({ type: 'snapshot', snapshot }));
  daemon.on('palette', (palette) => broadcast({ type: 'palette', palette }));
  daemon.on('log', ({ line }) => broadcast({ type: 'log', line, at: Date.now() }));
  daemon.on('transcript', ({ slot, role, text }) =>
    broadcast({ type: 'transcript', slot, role, text, at: Date.now() }),
  );

  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'snapshot', snapshot: daemon.snapshot() }));
    socket.send(JSON.stringify({ type: 'palette', palette: daemon.getPalette() }));
    socket.send(
      JSON.stringify({ type: 'profile', profile: daemon.profile }),
    );

    socket.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      void handleClientMessage(daemon, msg, socket);
    });
  });

  server.listen(port, '127.0.0.1');
  return server;
}

async function handleClientMessage(
  daemon: Daemon,
  msg: ClientMessage,
  socket: WebSocket,
): Promise<void> {
  const mock = daemon.mock;
  switch (msg.type) {
    case 'sim-button':
      mock?.simButton(msg.button as never, msg.down);
      break;
    case 'sim-tap':
      mock?.simTap(msg.button as never);
      break;
    case 'sim-stick':
      mock?.simStick(msg.which, msg.x, msg.y);
      break;
    case 'sim-trigger':
      mock?.simTrigger(msg.which, msg.value);
      break;
    case 'sim-swipe':
      void mock?.simSwipe(msg.direction);
      break;
    case 'action':
      await daemon.handleAction(msg.action as never, 'dashboard');
      break;
    case 'set-mode':
      daemon.setMode(msg.mode);
      break;
    case 'prompt':
      if (daemon.opts.backend === 'sdk') {
        daemon.promptSdk(msg.slot ?? daemon.sessions.activeSlot, msg.text, msg.cwd);
      } else {
        await daemon.promptPty(msg.text);
      }
      break;
    case 'palette-select':
      daemon.paletteSelect(msg.index);
      break;
    case 'palette-confirm':
      await daemon.paletteConfirm();
      break;
    case 'palette-close':
      daemon.closePalette();
      break;
    case 'get-profile':
      socket.send(JSON.stringify({ type: 'profile', profile: daemon.profile }));
      break;
    case 'set-profile': {
      const result = daemon.applyProfile(msg.profile);
      socket.send(JSON.stringify({ type: 'profile-result', ...result }));
      if (result.ok) {
        socket.send(JSON.stringify({ type: 'profile', profile: daemon.profile }));
      }
      break;
    }
  }
}
