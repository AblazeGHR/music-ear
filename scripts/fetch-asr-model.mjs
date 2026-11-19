// scripts/fetch-asr-model.mjs — fetch the offline speech model used by the
// Android app and unpack it into the APK's assets.
//
// The model is 40 MB, so it is NOT committed: this script downloads it once
// into .cache/ and copies the unpacked tree into android/.../assets/asr-model.
// `npm run android` calls it automatically when the assets are missing.
//
// Model: Vosk small English (US), Apache-2.0 — https://alphacephei.com/vosk/models

import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync,
  statSync } from 'node:fs';
import { get } from 'node:https';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { cpSync } from 'node:fs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const URL = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip';
const EXPECTED_BYTES = 41205931;
const CACHE_DIR = join(ROOT, '.cache');
const ZIP = join(CACHE_DIR, 'vosk-model-small-en-us-0.15.zip');
const OUT = join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'asr-model');
export const MODEL_READY = join(OUT, 'am', 'final.mdl');

function download() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const part = `${ZIP}.part`;
  return new Promise((resolve, reject) => {
    const req = get(URL, { family: 4, headers: { 'user-agent': 'music-ear-build' } }, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`model download failed: HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const total = Number(res.headers['content-length'] ?? 0);
      let seen = 0;
      let lastPct = -10;
      const out = createWriteStream(part);
      res.on('data', chunk => {
        seen += chunk.length;
        const pct = total ? Math.floor((seen / total) * 100) : 0;
        if (pct >= lastPct + 10) { lastPct = pct; console.log(`  ${pct}% of ${(total / 1048576).toFixed(1)} MB`); }
      });
      res.pipe(out);
      out.on('finish', () => out.close(err => (err ? reject(err) : resolve(part))));
      out.on('error', reject);
    });
    req.on('error', reject);
  });
}

function extract(zip, into) {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  // bsdtar (Windows 10+, macOS) reads zip; GNU tar does not, hence unzip first.
  for (const cmd of [['unzip', ['-q', zip, '-d', into]], ['tar', ['-xf', zip, '-C', into]]]) {
    const r = spawnSync(cmd[0], cmd[1], { stdio: 'ignore' });
    if (r.status === 0) return;
  }
  throw new Error('could not extract the model (need unzip or tar)');
}

export async function ensureAsrModel() {
  if (existsSync(MODEL_READY)) return OUT;

  if (!existsSync(ZIP) || statSync(ZIP).size !== EXPECTED_BYTES) {
    console.log('downloading the offline speech model (Vosk small en-US, ~40 MB)…');
    const part = await download();
    if (statSync(part).size !== EXPECTED_BYTES) {
      throw new Error(`model size mismatch: got ${statSync(part).size}`);
    }
    rmSync(ZIP, { force: true });
    cpSync(part, ZIP);
    rmSync(part, { force: true });
  }

  const tmp = join(CACHE_DIR, 'unpacked');
  console.log('unpacking the model…');
  extract(ZIP, tmp);
  const entries = readdirSync(tmp);
  const src = entries.length === 1 && statSync(join(tmp, entries[0])).isDirectory()
    ? join(tmp, entries[0])
    : tmp;

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(dirname(OUT), { recursive: true });
  cpSync(src, OUT, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });

  if (!existsSync(MODEL_READY)) throw new Error(`model unpacked but ${MODEL_READY} is missing`);
  console.log(`model ready: ${OUT}`);
  return OUT;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureAsrModel().catch(err => { console.error(err.message); process.exit(1); });
}
