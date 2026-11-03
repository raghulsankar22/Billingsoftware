import { verifyTamilPreviewDirectory } from './tamil-preview-safety.mjs';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.BILLING_PREVIEW_PORT || 3101);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3100) {
  throw new Error('Choose a website preview port from 1024 to 65535, excluding the desktop app port 3100.');
}

if (port === 3103 || process.env.BILLING_TAMIL_PREVIEW === '1') {
  if (port !== 3103) throw new Error('Tamil demo must use port 3103.');
  verifyTamilPreviewDirectory(root, process.env.LOCAL_DATA_DIR);
  process.env.BILLING_TAMIL_PREVIEW = '1';
}

if (port === 3110 || process.env.BILLING_CASHBOOK_PREVIEW === '1') {
  if (port !== 3110) throw new Error('Cash-book demo must use port 3110.');
  const { verifyCashBookPreviewDirectory } = await import('./cashbook-preview-safety.mjs');
  verifyCashBookPreviewDirectory(root, process.env.LOCAL_DATA_DIR);
  process.env.BILLING_CASHBOOK_PREVIEW = '1';
}

// Next writes this preview's private build folder into these tracked files when it starts.
const tracked = ['next-env.d.ts', 'tsconfig.json'].map(name => path.join(root, name));
const originals = tracked.map(file => readFileSync(file));
function restoreTrackedFiles() {
  tracked.forEach((file, index) => { if (!readFileSync(file).equals(originals[index])) writeFileSync(file, originals[index]); });
}
async function restoreOnceStarted() {
  for (let attempt = 0; attempt < 600; attempt++) {
    try { await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) }); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  restoreTrackedFiles();
}

console.log(`Finance Billing website preview: http://127.0.0.1:${port}/`);
const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  env: {
    ...process.env,
    NEXT_PUBLIC_BILLING_STORAGE: 'local',
    BILLING_MULTI_USER: process.env.BILLING_MULTI_USER ?? '1',
    NEXT_TELEMETRY_DISABLED: '1',
    BILLING_NEXT_DIST_DIR: `.next-website-${port}`,
    LOCAL_DATA_DIR: process.env.LOCAL_DATA_DIR || path.join(root, 'data'),
  },
  windowsHide: true,
  stdio: 'inherit',
});
void restoreOnceStarted();
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.on('exit', code => { restoreTrackedFiles(); process.exit(code ?? 1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.kill(); });
