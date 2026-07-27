/**
 * WebSocket device transport. Doubles as the P1 WiFi transport (an ESP32
 * connects the same way the browser emulator does) and, when given a static
 * dir, serves the emulator itself so a single port is all you need.
 *
 * If a `token` is set, a device must first send `{ t: 'hello', token }`;
 * anything else is closed. This is where the addon's LAN auth lives — never
 * in the daemon.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Transport } from './transport.js';
import { parseDeviceEvent } from '../protocol.js';
import type { HudFrame } from '../protocol.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export interface WsTransportOptions {
  port: number;
  host?: string;
  /** if set, a device must send `{t:'hello', token}` before anything else */
  token?: string;
  /** serve the emulator (or any static UI) from this dir on the same port */
  staticDir?: string | null;
  log?: (line: string) => void;
}

interface ClientRec {
  id: string;
  authed: boolean;
}

export class WsTransport extends Transport {
  readonly name = 'ws';
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, ClientRec>();
  private lastFrame: HudFrame | null = null;
  private nextId = 1;

  constructor(private opts: WsTransportOptions) {
    super();
  }

  get deviceCount(): number {
    let n = 0;
    for (const c of this.clients.values()) if (c.authed) n++;
    return n;
  }

  start(): void {
    const host = this.opts.host ?? '127.0.0.1';
    this.server = http.createServer((req, res) => this.serveStatic(req, res));
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (socket) => this.onConnection(socket));
    this.server.listen(this.opts.port, host);
    this.log(`listening on http://${host}:${this.opts.port}  (ws + emulator)`);
  }

  private serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
    const dir = this.opts.staticDir;
    if (!dir) {
      res.writeHead(426, { 'content-type': 'text/plain' });
      res.end('websocket only');
      return;
    }
    const url = (req.url ?? '/').split('?')[0]!;
    let file = path.join(dir, url === '/' ? 'index.html' : url);
    if (!file.startsWith(dir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(file)) file = path.join(dir, 'index.html');
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
  }

  private onConnection(socket: WebSocket): void {
    const id = `dev${this.nextId++}`;
    const rec: ClientRec = { id, authed: !this.opts.token };
    this.clients.set(socket, rec);

    if (rec.authed) this.admit(socket, rec);

    socket.on('message', (raw) => {
      const ev = parseDeviceEvent(raw as Buffer);
      if (!ev) return;
      if (!rec.authed) {
        if (ev.t === 'hello' && ev.token === this.opts.token) {
          rec.authed = true;
          this.admit(socket, rec);
        } else {
          socket.close(1008, 'unauthorized');
        }
        return;
      }
      if (ev.t === 'hello') return; // already admitted
      this.emit('event', { ev, deviceId: rec.id });
    });

    socket.on('close', () => {
      const wasAuthed = this.clients.get(socket)?.authed;
      this.clients.delete(socket);
      if (wasAuthed) this.emit('disconnect', { deviceId: rec.id });
    });
    // a socket error is always followed by 'close'; nothing to do here
    socket.on('error', () => undefined);
  }

  private admit(socket: WebSocket, rec: ClientRec): void {
    this.emit('connect', { deviceId: rec.id });
    if (this.lastFrame && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(this.lastFrame));
    }
  }

  broadcast(frame: HudFrame): void {
    this.lastFrame = frame;
    const data = JSON.stringify(frame);
    for (const [socket, rec] of this.clients) {
      if (rec.authed && socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  }

  stop(): void {
    for (const socket of this.clients.keys()) socket.close();
    this.clients.clear();
    this.wss?.close();
    this.server?.close();
    this.server = null;
    this.wss = null;
  }

  private log(line: string): void {
    this.opts.log?.(`[ws] ${line}`);
  }
}
