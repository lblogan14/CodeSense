/**
 * Bundle the CLI into a self-contained publishable package layout:
 *   dist-pkg/index.js     — esbuild bundle (workspace packages inlined)
 *   dist-pkg/profiles/    — default mapping profiles
 *   dist-pkg/dashboard/   — built web dashboard
 *   dist-pkg/assets/      — udev rules etc.
 * Native/binary deps (node-hid, node-pty, agent SDK) stay external.
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const repoRoot = path.resolve(pkgRoot, '../..');
const out = path.join(pkgRoot, 'dist-pkg');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(pkgRoot, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(out, 'index.js'),
  external: ['node-hid', 'node-pty', '@anthropic-ai/claude-agent-sdk'],
  banner: {
    js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
  },
  logLevel: 'info',
});

const copyDir = (src, dst) => {
  if (!fs.existsSync(src)) throw new Error(`missing ${src} — build it first`);
  fs.cpSync(src, dst, { recursive: true });
};

copyDir(path.join(repoRoot, 'profiles'), path.join(out, 'profiles'));
copyDir(path.join(repoRoot, 'packages/dashboard/dist'), path.join(out, 'dashboard'));
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.copyFileSync(
  path.join(repoRoot, 'assets/70-codesense-dualsense.rules'),
  path.join(out, 'assets/70-codesense-dualsense.rules'),
);
fs.copyFileSync(path.join(repoRoot, 'README.md'), path.join(pkgRoot, 'README.md'));

console.log('dist-pkg ready:', fs.readdirSync(out).join(', '));
