// scripts/fetch-asr-model.mjs — fetch the offline speech models used by the
// Android app and unpack them into .cache/asr/<lang>/.
//
// Models are ~40 MB, so they are NOT committed. `npm run android` downloads the
// model for the language being built and copies it into the APK's assets.
//
// Models (Apache-2.0): https://alphacephei.com/vosk/models

import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync,
  statSync, cpSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const MODELS = {
  en: {
    name: 'vosk-model-small-en-us-0.15',
    url: 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip',
    bytes: 41205931,
  },
  zh: {
    name: 'vosk-model-small-cn-0.22',
    url: 'https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip',
    bytes: 43898754,
  },
};
const CACHE = join(ROOT, '.cache', 'asr');
// Earlier builds downloaded the English zip under its own name; reuse it.
const LEGACY_ZIP = join(ROOT, '.cache', 'vosk-model-small-en-us-0.15.zip');

function cachePaths(lang) {
  return {
    zip: join(CACHE, `${lang}.zip`),
    dir: join(CACHE, `${lang}`),
  };
}

function download(url, dest, bytes) {
  mkdirSync(CACHE, { recursive: true });
  const part = `${dest}.part`;
  const start = existsSync(part) ? statSync(part).size : 0;
  if (start > 0) console.log(`  resuming at ${(start / 1048576).toFixed(1)} MB`);
  return new Promise((resolve, reject) => {
    const headers = { 'user-agent': 'music-ear-build' };
    if (start > 0) headers.range = `bytes=${start}-`;
    const req = get(url, { family: 4, headers }, res => {
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        reject(new Error(`model download failed: HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const resumed = res.statusCode === 206 && start > 0;
      const total = resumed
        ? start + Number(res.headers['content-length'] ?? 0)
        : Number(res.headers['content-length'] ?? bytes ?? 0);
      let seen = resumed ? start : 0;
      let lastPct = -10;
      const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' });
      res.on('data', chunk => {
        seen += chunk.length;
        const pct = total ? Math.floor((seen / total) * 100) : 0;
        if (pct >= lastPct + 10) {
          lastPct = pct;
          console.log(`  ${pct}% of ${(total / 1048576).toFixed(1)} MB`);
        }
      });
      res.pipe(out);
      out.on('finish', () => out.close(err => (err ? reject(err) : resolve())));
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

function modelRoot(lang) {
  const { dir } = cachePaths(lang);
  const entries = readdirSync(dir).filter(e => statSync(join(dir, e)).isDirectory());
  return entries.length === 1 ? join(dir, entries[0]) : dir;
}

export async function ensureAsrModel(lang = 'en') {
  const spec = MODELS[lang];
  if (!spec) throw new Error(`unknown language "${lang}" (expected en or zh)`);
  const { zip, dir } = cachePaths(lang);

  if (!existsSync(join(dir, '.ready'))) {
    if (lang === 'en' && !existsSync(zip) && existsSync(LEGACY_ZIP)
      && statSync(LEGACY_ZIP).size === spec.bytes) {
      cpSync(LEGACY_ZIP, zip);
    }
    if (!existsSync(zip) || statSync(zip).size !== spec.bytes) {
      console.log(`downloading the offline speech model (${spec.name}, ~${Math.round(spec.bytes / 1048576)} MB)…`);
      const part = `${zip}.part`;
      rmSync(part, { force: true });
      await download(spec.url, zip, spec.bytes);
      const got = statSync(part).size;
      if (got !== spec.bytes) throw new Error(`model size mismatch: got ${got}, expected ${spec.bytes}`);
      rmSync(zip, { force: true });
      cpSync(part, zip);
      rmSync(part, { force: true });
    }
    console.log('unpacking the model…');
    extract(zip, dir);
    writeFileSync(join(dir, '.ready'), spec.name);
  }

  const root = modelRoot(lang);
  if (!existsSync(join(root, 'am', 'final.mdl'))) {
    throw new Error(`model ${lang} is incomplete; delete ${dir} and retry`);
  }
  return root;
}

/** Copy one unpacked model into the APK asset tree (replacing what is there). */
export async function installAsrModel(lang, dest) {
  const root = await ensureAsrModel(lang);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(root, dest, { recursive: true });
  return dest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  const langs = arg === 'all' ? Object.keys(MODELS) : [arg || 'en'];
  (async () => {
    for (const lang of langs) {
      const root = await ensureAsrModel(lang);
      console.log(`model ready (${lang}): ${root}`);
    }
  })().catch(err => { console.error(err.message); process.exit(1); });
}
