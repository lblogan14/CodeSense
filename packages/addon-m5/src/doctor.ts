/**
 * `codesense-m5 doctor` — quick diagnostics before you start the bridge:
 * is the daemon reachable, and which serial ports look like a CoreS3?
 */
import { WebSocket } from 'ws';

export interface DoctorOptions {
  daemonUrl: string;
  port: number;
  serial?: string;
  log: (line: string) => void;
}

export async function runDoctor(opts: DoctorOptions): Promise<number> {
  const { log } = opts;
  log('codesense-m5 doctor');
  log('');

  const daemonOk = await checkDaemon(opts.daemonUrl, log);
  await listSerialPorts(log, opts.serial);
  log(`  device port   ${opts.port} (ws + emulator)`);

  log('');
  log(
    daemonOk
      ? '✓ daemon reachable — start the bridge with: codesense-m5'
      : '✗ daemon not reachable — is `codesense start` running on this machine?',
  );
  return daemonOk ? 0 : 1;
}

function checkDaemon(url: string, log: (l: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const ws = new WebSocket(url);
    const finish = (ok: boolean, msg: string): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      log(msg);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false, `  daemon        ✗ no response at ${url}`), 2500);
    timer.unref?.();
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse((raw as Buffer).toString('utf8')) as {
          type?: string;
          snapshot?: { backend?: string };
        };
        if (m.type === 'snapshot') {
          finish(true, `  daemon        ✓ ${url} (backend: ${m.snapshot?.backend ?? '?'})`);
        }
      } catch {
        /* ignore */
      }
    });
    ws.on('error', () => finish(false, `  daemon        ✗ cannot connect to ${url}`));
  });
}

async function listSerialPorts(log: (l: string) => void, hint?: string): Promise<void> {
  try {
    const spec = 'serialport';
    const mod = (await import(spec)) as {
      SerialPort: { list(): Promise<Array<{ path: string; vendorId?: string; productId?: string }>> };
    };
    const ports = await mod.SerialPort.list();
    if (ports.length === 0) {
      log('  serial        (no ports found)');
      return;
    }
    for (const p of ports) {
      const esp = (p.vendorId ?? '').toLowerCase() === '303a';
      const ids = p.vendorId ? ` (${p.vendorId}:${p.productId ?? '????'})` : '';
      log(`  serial        ${p.path}${ids}${esp ? '  ← Espressif (CoreS3?)' : ''}`);
    }
  } catch {
    log(
      `  serial        (install 'serialport' to list ports${hint ? `; expecting ${hint}` : ''})`,
    );
  }
}
