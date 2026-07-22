import { execSync } from 'node:child_process';
import * as clack from '@clack/prompts';
import pc from 'picocolors';
import { findDualSenseDevices } from '@codesense/hid';
import { hooksInstalled, userSettingsPath } from '@codesense/backend-pty';
import { findDashboardDist } from './server.js';

interface Check {
  name: string;
  run: () => { ok: boolean; warn?: boolean; detail: string; fix?: string };
}

export async function runDoctor(): Promise<number> {
  clack.intro(pc.bold('codesense doctor'));

  const checks: Check[] = [
    {
      name: 'node version',
      run: () => {
        const major = Number(process.versions.node.split('.')[0]);
        return {
          ok: major >= 20,
          detail: `node ${process.versions.node}`,
          fix: 'install Node 20 or newer',
        };
      },
    },
    {
      name: 'claude cli',
      run: () => {
        try {
          const v = execSync('claude --version', { encoding: 'utf8', timeout: 15000 }).trim();
          return { ok: true, detail: v };
        } catch {
          return {
            ok: false,
            detail: 'claude not found on PATH',
            fix: 'npm install -g @anthropic-ai/claude-code',
          };
        }
      },
    },
    {
      name: 'controller',
      run: () => {
        try {
          const devices = findDualSenseDevices();
          if (devices.length === 0) {
            return {
              ok: false,
              warn: true,
              detail: 'no DualSense detected',
              fix: 'plug the controller in over USB (Bluetooth needs --experimental-bt)',
            };
          }
          const d = devices[0]!;
          return { ok: true, detail: `${d.product} · ${d.guessedConnection}` };
        } catch (err) {
          return { ok: false, detail: `HID enumeration failed: ${String(err)}` };
        }
      },
    },
    {
      name: 'hid contention',
      run: () => {
        try {
          const out = execSync('tasklist /fo csv', { encoding: 'utf8', timeout: 15000 });
          const fighters = ['DS4Windows', 'DualSenseX', 'steam.exe']
            .filter((p) => out.toLowerCase().includes(p.toLowerCase()));
          if (fighters.length) {
            return {
              ok: true,
              warn: true,
              detail: `running: ${fighters.join(', ')}`,
              fix: 'these can fight CodeSense for the controller — disable their PS5 support while codesense runs',
            };
          }
          return { ok: true, detail: 'no known conflicting remappers running' };
        } catch {
          return { ok: true, warn: true, detail: 'could not inspect processes' };
        }
      },
    },
    {
      name: 'claude hooks',
      run: () => {
        const installed = hooksInstalled();
        return {
          ok: installed,
          warn: !installed,
          detail: installed
            ? `installed in ${userSettingsPath()}`
            : 'not installed — the lightbar cannot see agent state',
          fix: 'codesense hooks install',
        };
      },
    },
    {
      name: 'dashboard build',
      run: () => {
        const dist = findDashboardDist();
        return {
          ok: dist !== null,
          warn: dist === null,
          detail: dist ?? 'dashboard not built',
          fix: 'pnpm --filter @codesense/dashboard build',
        };
      },
    },
  ];

  let failed = 0;
  let warned = 0;
  for (const check of checks) {
    const r = check.run();
    const glyph = r.ok && !r.warn ? pc.green('✓') : r.warn ? pc.yellow('▲') : pc.red('✕');
    clack.log.message(`${glyph} ${pc.bold(check.name.padEnd(16))} ${pc.dim(r.detail)}`);
    if (!r.ok || r.warn) {
      if (r.fix) clack.log.message(pc.dim(`    fix: ${r.fix}`));
      if (!r.ok) failed++;
      else warned++;
    }
  }

  const passed = checks.length - failed - warned;
  clack.outro(
    `${passed} passed · ${warned} warning${warned === 1 ? '' : 's'} · ${failed} failed`,
  );
  return failed > 0 ? 1 : 0;
}
