import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCashBookPreviewDirectory } from './cashbook-preview-safety.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = verifyCashBookPreviewDirectory(root, process.env.LOCAL_DATA_DIR || path.join(root, 'tmp', 'cashbook-website-demo'));
const origin = 'http://127.0.0.1:3110';
function verify(health) {
  if (health.application !== 'finance-billing' || health.demo !== true || path.resolve(health.dataDirectory ?? '') !== directory) throw new Error('Port 3110 is occupied by a different server. It was not reused.');
}
try {
  const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Port 3110 is occupied by a different server.');
  verify(await response.json()); console.log('Synthetic cash-book demo already running: ' + origin);
} catch (error) {
  if (error.cause?.code !== 'ECONNREFUSED') throw error;
  const log = openSync(path.join(directory, 'preview-server.log'), 'a');
  try {
    const server = spawn(process.execPath, [path.join(root, 'scripts', 'preview-website.mjs')], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, BILLING_PREVIEW_PORT: '3110', BILLING_CASHBOOK_PREVIEW: '1', BILLING_TAMIL_PREVIEW: '0', BILLING_MULTI_USER: '1', LOCAL_DATA_DIR: directory } });
    server.unref();
  } finally { closeSync(log); }
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(2000) });
      if (!response.ok) throw new Error('Unexpected server on port 3110.');
      verify(await response.json()); ready = true; break;
    } catch (failure) {
      if (failure.message.includes('different server') || failure.message.includes('Unexpected server')) throw failure;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (!ready) throw new Error('Cash-book demo did not become ready. Check its sample preview-server.log.');
  console.log('Synthetic cash-book demo ready: ' + origin + ' — sample data only.');
}

