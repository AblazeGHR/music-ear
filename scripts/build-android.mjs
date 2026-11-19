// scripts/build-android.mjs — stage the static site + ONE speech model into
// the Android app and build an APK.
//
// Usage:
//   npm run android                    → Chinese debug APK (installable)
//   npm run android:en                 → English debug APK
//   npm run android:release            → Chinese release APK (unsigned)
//   npm run android:en:release         → English release APK (unsigned)
//   node scripts/build-android.mjs --lang=en --task=assembleDebug
//
// Each APK carries a single Vosk model (~40 MB) and starts the web app with
// ?lang=<lang>, so the lean builds cannot switch languages at runtime.
//
// Requires a JDK 17+ and the Android SDK (ANDROID_HOME). Gradle itself is
// fetched by the wrapper on first run.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stageWeb } from './stage-web.mjs';
import { installAsrModel, MODELS } from './fetch-asr-model.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const lang = (args.find(a => a.startsWith('--lang='))?.split('=')[1]) ?? 'zh';
const task = args.find(a => !a.startsWith('--')) ?? 'assembleDebug';

if (!MODELS[lang]) {
  console.error(`unknown language "${lang}" — expected en or zh`);
  process.exit(1);
}

process.chdir(root);
await installAsrModel(lang, join('android', 'app', 'src', 'main', 'assets', 'asr-model'));
stageWeb(join('android', 'app', 'src', 'main', 'assets', 'www'));

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
if (!existsSync(join('android', gradlew))) {
  console.error(`missing android/${gradlew} — run "gradle wrapper" in android/ once`);
  process.exit(1);
}

console.log(`building ${task} for language "${lang}"…`);
const r = spawnSync(gradlew, [task, `-PappLang=${lang}`], {
  cwd: join(root, 'android'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
