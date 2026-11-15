// scripts/stage-web.mjs — copy the runtime files (and only those) into a
// directory. Shared by the Cloudflare deploy and the Android APK build, so the
// two never drift on which files the app actually ships.

import { cpSync, mkdirSync, rmSync } from 'node:fs';

export const FILES = ['index.html', 'manifest.webmanifest', 'sw.js'];
export const DIRS = ['css', 'js', 'assets'];

export function stageWeb(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const f of FILES) cpSync(f, `${outDir}/${f}`);
  for (const d of DIRS) cpSync(d, `${outDir}/${d}`, { recursive: true });
  return outDir;
}
