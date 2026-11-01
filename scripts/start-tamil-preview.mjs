import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTamilPreviewDirectory } from './tamil-preview-safety.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'tmp', 'tamil-website-demo');
if (process.env.LOCAL_DATA_DIR && path.resolve(process.env.LOCAL_DATA_DIR) !== directory) throw new Error('Remove the LOCAL_DATA_DIR override. This launcher only uses synthetic Tamil demo data.');
if (process.argv.includes('--initialize') && !existsSync(directory)) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, '.tamil-demo'), 'synthetic-tamil-preview-v1', { flag: 'wx' });
}
verifyTamilPreviewDirectory(root, directory);
const origin = 'http://127.0.0.1:3103';
try {
  const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(3000) });
  const health = await response.json();
  if (!response.ok || health.application !== "finance-billing" || health.demo !== true || path.resolve(health.dataDirectory ?? '') !== directory) throw new Error('Port 3103 is occupied by a different server.');
  console.log('Synthetic Tamil demo already running: ' + origin);
} catch (error) {
  if (error.cause?.code !== 'ECONNREFUSED') throw error;
  const log = openSync(path.join(directory, 'preview-server.log'), 'a');
  try {
    const server = spawn(process.execPath, [path.join(root, 'scripts', 'preview-website.mjs')], {
      cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log],
      env: { ...process.env, BILLING_PREVIEW_PORT: '3103', BILLING_TAMIL_PREVIEW: '1', BILLING_MULTI_USER: '1', LOCAL_DATA_DIR: directory },
    });
    server.unref();
  } finally { closeSync(log); }
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(2000) });
      const health = await response.json();
      if (!response.ok || health.application !== 'finance-billing' || health.demo !== true || path.resolve(health.dataDirectory ?? '') !== directory) throw new Error('Unexpected server on port 3103.');
      ready = true;
      break;
    } catch (failure) {
      if (failure.message === 'Unexpected server on port 3103.') throw failure;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (!ready) throw new Error('Tamil demo did not become ready. Check the sample folder preview-server.log.');
  console.log('Synthetic Tamil demo ready: ' + origin + ' — sample data only, never the real ledger.');
}
