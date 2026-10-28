import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBillingServer, probeServer } from '../desktop/server.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'tmp'), { recursive: true });
const dataDirectory = await mkdtemp(path.join(root, 'tmp/desktop-verification-'));
const listener = createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const server = await ensureBillingServer({ runtimeDirectory: path.join(root, '.desktop-runtime'), dataDirectory, port });
try {
  if (!server.owned) throw new Error('Desktop verification must use an isolated server.');
  const html = await (await fetch(server.origin)).text();
  if (!html.includes('Finance Billing')) throw new Error('Billing homepage is missing.');
  for (const asset of ['/business-logo.jpg', '/fonts/NotoSansTamil-Regular.ttf']) {
    if (!(await fetch(server.origin + asset)).ok) throw new Error(`Missing offline asset: ${asset}`);
  }
  await new Promise((resolve, reject) => {
    const test = spawn(process.execPath, [path.join(root, 'scripts/verify-local.mjs')], {
      cwd: root, env: { ...process.env, BILLING_TEST_URL: server.origin }, windowsHide: true, stdio: 'inherit',
    });
    test.on('error', reject);
    test.on('exit', code => code === 0 ? resolve() : reject(new Error(`Offline billing verification failed (${code}).`)));
  });
  console.log('Bundled desktop runtime verified: billing, accounts, PDF, Excel, delivery and offline assets.');
} finally {
  server.stop();
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await probeServer(server.origin, dataDirectory) === 'stopped') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (await probeServer(server.origin, dataDirectory) !== 'stopped') throw new Error('Desktop server did not stop when closed.');
}
