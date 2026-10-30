const { spawn } = require('node:child_process');
const { closeSync, existsSync, mkdirSync, openSync } = require('node:fs');
const path = require('node:path');
const { isBillingHealth } = require('./security.cjs');

async function probeServer(origin, directory, requireMultiUser = false) {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (response.ok && isBillingHealth(await response.json(), directory, requireMultiUser)) return 'ready';
    return 'occupied';
  } catch (error) {
    return error.cause?.code === 'ECONNREFUSED' ? 'stopped' : 'unavailable';
  }
}

async function ensureBillingServer({ runtimeDirectory, dataDirectory, port = 3100, onUnexpectedExit = () => {} }) {
  const origin = `http://127.0.0.1:${port}`;
  const requireMultiUser = process.env.BILLING_MULTI_USER === '1' || (process.env.BILLING_MULTI_USER !== '0' && process.env.NODE_ENV !== 'test');
  const status = await probeServer(origin, dataDirectory, requireMultiUser);
  if (status === 'ready') return { origin, owned: false, stop() {} };
  if (status !== 'stopped') throw new Error(`Port ${port} is already in use, or an older billing server is running. Close the older server and try again. Your bills have not been changed.`);
  const serverDirectory = path.join(runtimeDirectory, 'server');
  const executable = path.join(runtimeDirectory, 'node.exe');
  const entrypoint = path.join(serverDirectory, 'server.js');
  if (!existsSync(executable) || !existsSync(entrypoint)) throw new Error('Billing program files are missing. Please reinstall the app. Do not delete the data folder.');
  mkdirSync(dataDirectory, { recursive: true });
  const log = openSync(path.join(dataDirectory, 'desktop-server.log'), 'a');
  let server;
  try {
    server = spawn(executable, [entrypoint], {
      cwd: serverDirectory,
      env: { ...process.env, NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: '', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', HOSTNAME: '127.0.0.1', PORT: String(port), LOCAL_DATA_DIR: dataDirectory, NEXT_PUBLIC_BILLING_STORAGE: 'local', BILLING_MULTI_USER: process.env.BILLING_MULTI_USER ?? '1' },
      windowsHide: true, stdio: ['ignore', log, log],
    });
  } finally { closeSync(log); }
  let stopped = false;
  let ready = false;
  let failure;
  server.on('error', error => { failure = error; });
  server.on('exit', (code) => {
    failure ??= new Error(`Billing server stopped (code ${code}). See desktop-server.log in the data folder.`);
    if (ready && !stopped) onUnexpectedExit(failure);
  });
  const stop = () => { stopped = true; if (server.exitCode === null) server.kill(); };
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (failure) throw failure;
      if (await probeServer(origin, dataDirectory, requireMultiUser) === 'ready') { ready = true; return { origin, owned: true, stop }; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Billing took too long to start. Check desktop-server.log in the data folder.');
  } catch (error) { stop(); throw error; }
}

module.exports = { ensureBillingServer, probeServer };
