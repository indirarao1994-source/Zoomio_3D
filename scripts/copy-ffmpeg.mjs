import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Copies the ffmpeg.wasm core into `public/ffmpeg/` so the studio can load it
 * from its own origin.
 *
 * Why not just use the CDN default: a self-hosted core keeps video export
 * working on an intranet or a flaky connection, avoids a third-party runtime
 * dependency on a paid feature, and dodges the CORS/COEP surprises that come
 * with cross-origin wasm. Why not commit it: the core is ~32 MB, which has no
 * business in git — so it is copied at build time and gitignored instead.
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/*
 * The ESM build, not UMD. @ffmpeg/ffmpeg always spawns its worker with
 * `type: "module"`, where `importScripts()` is unavailable — so the worker
 * falls back to `await import(coreURL)` and reads `.default`. The UMD bundle
 * has no default export, so that path throws "failed to import
 * ffmpeg-core.js". The ESM build ends in `export default createFFmpegCore`.
 */
const src = path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const dest = path.join(root, 'public', 'ffmpeg');

const FILES = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

if (!fs.existsSync(src)) {
  console.error(
    '[ffmpeg] @ffmpeg/core is not installed — video export will be unavailable.\n' +
      '         Run: npm install @ffmpeg/core',
  );
  // Not fatal: everything except video export still builds and runs.
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });

let copied = 0;
for (const name of FILES) {
  const from = path.join(src, name);
  const to = path.join(dest, name);
  if (!fs.existsSync(from)) {
    console.error(`[ffmpeg] missing ${name} in @ffmpeg/core`);
    continue;
  }
  // Skip identical copies so repeat builds stay fast.
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue;
  fs.copyFileSync(from, to);
  copied++;
}

console.log(
  copied > 0
    ? `[ffmpeg] copied ${copied} file(s) into public/ffmpeg/`
    : '[ffmpeg] core already up to date',
);
