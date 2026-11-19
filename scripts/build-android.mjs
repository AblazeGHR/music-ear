// scripts/build-android.mjs — stage the static site into the Android app and
// build an APK.
//
// Usage:
//   npm run android                 → debug APK (installable as-is)
//   npm run android -- assembleRelease
//
// Requires a JDK 17+ and the Android SDK (ANDROID_HOME). Gradle itself is
// fetched by the wrapper on first run.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stageWeb } from './stage-web.mjs';
import { ensureAsrModel } from './fetch-asr-model.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const task = process.argv[2] ?? 'assembleDebug';

process.chdir(root);
await ensureAsrModel();
stageWeb(join('android', 'app', 'src', 'main', 'assets', 'www'));

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
if (!existsSync(join('android', gradlew))) {
  console.error(`missing android/${gradlew} — run "gradle wrapper" in android/ once`);
  process.exit(1);
}

const r = spawnSync(gradlew, [task], {
  cwd: join(root, 'android'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
