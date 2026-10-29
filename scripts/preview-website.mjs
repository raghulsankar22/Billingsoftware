import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.BILLING_PREVIEW_PORT || 3101);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3100) {
  throw new Error('Choose a website preview port from 1024 to 65535, excluding the desktop app port 3100.');
}

console.log(`Finance Billing website preview: http://127.0.0.1:${port}/`);
const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  env: {
    ...process.env,
    NEXT_PUBLIC_BILLING_STORAGE: 'local',
    NEXT_TELEMETRY_DISABLED: '1',
    BILLING_NEXT_DIST_DIR: `.next-website-${port}`,
    LOCAL_DATA_DIR: process.env.LOCAL_DATA_DIR || path.join(root, 'data'),
  },
  windowsHide: true,
  stdio: 'inherit',
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.kill(); });
