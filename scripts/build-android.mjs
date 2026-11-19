// scripts/build-android.mjs — stage the static site + speech model(s) into the
// Android app and build an APK.
//
// Usage:
//   npm run android                → bilingual debug APK (both models, switch)
//   npm run android:release        → Chinese release APK (lean, one model)
//   npm run android:en:release     → English release APK (lean, one model)
//   node scripts/build-android.mjs --lang=multi|en|zh --task=assembleDebug
//
// Debug builds are bilingual by default; only release builds are trimmed to a
// single language and locked with ?lang=<lang>.
//
// Requires a JDK 17+ and the Android SDK (ANDROID_HOME). Gradle itself is
// fetched by the wrapper on first run.

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stageWeb } from './stage-web.mjs';
import { installAsrModel } from './fetch-asr-model.mjs';

const LANGS = { multi: ['en', 'zh'], en: ['en'], zh: ['zh'] };

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const lang = (args.find(a => a.startsWith('--lang='))?.split('=')[1]) ?? 'multi';
const task = (args.find(a => a.startsWith('--task='))?.split('=')[1])
  ?? args.find(a => !a.startsWith('--'))
  ?? 'assembleDebug';

if (!LANGS[lang]) {
  console.error(`unknown language "${lang}" — expected multi, en or zh`);
  process.exit(1);
}

process.chdir(root);

const assets = join('android', 'app', 'src', 'main', 'assets');
const modelRoot = join(assets, 'asr-model');
rmSync(modelRoot, { recursive: true, force: true });
for (const code of LANGS[lang]) {
  await installAsrModel(code, join(modelRoot, code));
}
stageWeb(join(assets, 'www'));

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
if (!existsSync(join('android', gradlew))) {
  console.error(`missing android/${gradlew} — run "gradle wrapper" in android/ once`);
  process.exit(1);
}

console.log(`building ${task} for "${lang}"…`);
const r = spawnSync(gradlew, [task, `-PappLang=${lang}`], {
  cwd: join(root, 'android'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
