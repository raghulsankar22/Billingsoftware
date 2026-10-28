import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = path.join(appDirectory, 'data');
const appUrl = 'http://127.0.0.1:3100/';

async function appIsReady() {
  try {
    const response = await fetch(`${appUrl}api/profile?account=1`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const body = await response.json();
    return Object.hasOwn(body, 'profile') && Array.isArray(body.profiles);
  } catch {
    return false;
  }
}

async function portIsOccupied() {
  try {
    await fetch(appUrl, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function start() {
  if (await appIsReady()) {
    console.log(`Finance Billing is ready at ${appUrl}`);
    return;
  }
  if (await portIsOccupied()) throw new Error('Port 3100 is being used by another program.');
  if (!existsSync(path.join(appDirectory, '.next', 'BUILD_ID'))) {
    throw new Error('The billing app is not built yet. Ask for help rebuilding it.');
  }

  mkdirSync(dataDirectory, { recursive: true });
  const log = openSync(path.join(dataDirectory, 'server.log'), 'a');
  try {
    const server = spawn(process.execPath, [
      path.join(appDirectory, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'start', '--hostname', '127.0.0.1', '--port', '3100',
    ], {
      cwd: appDirectory,
      env: { ...process.env, LOCAL_DATA_DIR: dataDirectory, NEXT_PUBLIC_BILLING_STORAGE: 'local' },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
    server.unref();
  } finally {
    closeSync(log);
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    if (await appIsReady()) {
      console.log(`Finance Billing is ready at ${appUrl}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Billing did not become ready. Check ${path.join(dataDirectory, 'server.log')}.`);
}

start().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
