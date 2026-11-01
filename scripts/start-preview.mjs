import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isBillingHealth } = require('../desktop/security.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = path.join(root, 'data');
const origin = 'http://127.0.0.1:3101';

async function status() {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return 'occupied';
    return isBillingHealth(await response.json(), dataDirectory, true) ? 'ready' : 'occupied';
  } catch (error) { return error.cause?.code === 'ECONNREFUSED' ? 'stopped' : 'unavailable'; }
}

const wait = () => new Promise(resolve => setTimeout(resolve, 500));

async function start() {
  // A preview that is still compiling answers slowly: that isn't another program.
  let initial = await status();
  for (let attempt = 0; initial === 'unavailable' && attempt < 240; attempt++) { await wait(); initial = await status(); }
  if (initial === 'ready') return;
  if (initial !== 'stopped') throw new Error('Port 3101 is being used by another program. Close it before starting the website.');
  mkdirSync(dataDirectory, { recursive: true });
  const log = openSync(path.join(dataDirectory, 'preview-server.log'), 'a');
  try {
    const server = spawn(process.execPath, [path.join(root, 'scripts', 'preview-website.mjs')], {
      cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log],
      env: { ...process.env, BILLING_PREVIEW_PORT: '3101', BILLING_MULTI_USER: '1', LOCAL_DATA_DIR: dataDirectory, NEXT_PUBLIC_BILLING_STORAGE: 'local' },
    });
    server.unref();
  } finally { closeSync(log); }
  for (let attempt = 0; attempt < 240; attempt++) {
    const current = await status();
    if (current === 'ready') return;
    if (current === 'occupied') throw new Error('A different program is using port 3101.');
    await wait();
  }
  throw new Error(`The website did not start. Check ${path.join(dataDirectory, 'preview-server.log')}.`);
}

start().then(() => console.log(`Finance Billing website is ready at ${origin}/`)).catch(error => { console.error(error.message); process.exitCode = 1; });
