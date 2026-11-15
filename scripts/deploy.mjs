// scripts/deploy.mjs — stage the static site into dist/ and deploy it to
// Cloudflare (Workers with Static Assets; see wrangler.jsonc).
//
// The app itself needs no build step — this script only copies the runtime
// files (never docs, tests, marketing or the review clones) into dist/, which
// is what wrangler uploads.
//
// Usage:  npm run deploy        (needs CLOUDFLARE_API_TOKEN in the environment)

import { spawnSync } from 'node:child_process';
import { stageWeb } from './stage-web.mjs';

stageWeb('dist');

console.log('staged dist/ — deploying to Cloudflare…');
const r = spawnSync('npx', ['--yes', 'wrangler@latest', 'deploy'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
