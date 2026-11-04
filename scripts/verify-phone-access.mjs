// Checks phone access against the real server (staged or packaged), using a disposable data folder.
// It uses the phone port (3110), so close anything else using it first.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBillingServer, probeServer } from '../desktop/server.cjs';
import { phoneAddresses, phonePort } from '../desktop/phone-access.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'tmp'), { recursive: true });
const dataDirectory = await mkdtemp(path.join(root, 'tmp/phone-access-verification-'));
const free = createServer();
await new Promise((resolve, reject) => { free.once('error', () => reject(new Error(`Port ${phonePort} is in use (is Finance Billing open with phone access on?). Close the program using it and run this check again.`))); free.listen(phonePort, '0.0.0.0', resolve); });
await new Promise(resolve => free.close(resolve));
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
process.env.BILLING_MULTI_USER = '1';
const runtimeDirectory = path.resolve(process.env.BILLING_TEST_RUNTIME_DIR || path.join(root, '.desktop-runtime'));
const server = await ensureBillingServer({ runtimeDirectory, dataDirectory, port });

// node:http lets the test choose the Host header, which fetch does not allow.
function raw(targetPort, { method = 'GET', url = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: targetPort, method, path: url, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, response => {
      let text = ''; response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: response.statusCode, headers: response.headers, text, json }); });
    });
    request.on('error', reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}
const cookieOf = result => String(result.headers['set-cookie']).split(';')[0];
async function waitFor(check, message) {
  for (let attempt = 0; attempt < 40; attempt++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 250)); }
  throw new Error(message);
}
const phoneUp = () => raw(phonePort, { url: '/api/health' }).then(() => true, () => false);
try {
  assert.ok(server.owned, 'Phone verification must use an isolated server.');
  const owner = await raw(port, { method: 'POST', url: '/api/local-auth', body: { action: 'setup', username: 'owner', password: 'password one' } });
  assert.equal(owner.status, 200);
  const ownerCookie = cookieOf(owner);
  await raw(port, { method: 'POST', url: '/api/local-auth', headers: { cookie: ownerCookie }, body: { action: 'create', username: 'helper', password: 'password two' } });
  const helper = await raw(port, { method: 'POST', url: '/api/local-auth', body: { action: 'login', username: 'helper', password: 'password two' } });
  const helperCookie = cookieOf(helper);

  // Off by default: nothing listens on the phone port, and only an administrator sees the switch.
  assert.equal(await phoneUp(), false, 'Phone access must be off until it is turned on.');
  const off = await raw(port, { url: '/api/phone-access', headers: { cookie: ownerCookie } });
  assert.deepEqual([off.json.administrator, off.json.enabled, off.json.addresses], [true, false, []]);
  assert.deepEqual((await raw(port, { url: '/api/phone-access', headers: { cookie: helperCookie } })).json, { administrator: false });
  assert.equal((await raw(port, { method: 'PUT', url: '/api/phone-access', headers: { cookie: helperCookie }, body: { enabled: true } })).status, 403);
  assert.equal((await raw(port, { method: 'PUT', url: '/api/phone-access', body: { enabled: true } })).status, 401);
  assert.equal((await raw(port, { method: 'PUT', url: '/api/phone-access', headers: { cookie: ownerCookie }, body: { enabled: 'yes' } })).status, 400);
  assert.equal(await phoneUp(), false);

  // The administrator turns it on from this computer; the phone listener starts without a restart.
  const on = await raw(port, { method: 'PUT', url: '/api/phone-access', headers: { cookie: ownerCookie }, body: { enabled: true } });
  assert.equal(on.status, 200); assert.equal(on.json.enabled, true); assert.equal(on.json.port, phonePort);
  await waitFor(phoneUp, 'The phone listener did not start.');

  // The listener is reachable on this computer's own network addresses (Wi-Fi or Tailscale), not only on loopback.
  for (const address of phoneAddresses(os.networkInterfaces())) {
    const viaNetwork = await fetch(address.url + '/', { signal: AbortSignal.timeout(5000) });
    assert.equal(viaNetwork.status, 200, `${address.url} did not answer`);
    console.log(`Reached phone access on ${address.kind} address ${address.url}`);
  }

  // A phone page works end to end: sign-in page, sign-in, and a protected request with the phone session.
  const home = await raw(phonePort, { url: '/', headers: { host: `192.168.1.20:${phonePort}` } });
  assert.equal(home.status, 200); assert.ok(home.text.includes('Finance Billing'));
  const manifest = await raw(phonePort, { url: '/manifest.webmanifest' });
  assert.equal(manifest.status, 200); assert.ok(manifest.text.includes('standalone'));
  assert.equal((await raw(phonePort, { url: '/icons/icon-192.png' })).status, 200);
  assert.equal((await raw(phonePort, { url: '/api/profile?account=1', headers: { host: `192.168.1.20:${phonePort}` } })).status, 401);
  const phoneHost = `192.168.1.20:${phonePort}`;
  const phoneLogin = await raw(phonePort, { method: 'POST', url: '/api/local-auth', headers: { host: phoneHost, origin: `http://${phoneHost}` }, body: { action: 'login', username: 'owner', password: 'password one' } });
  assert.equal(phoneLogin.status, 200, phoneLogin.text);
  const phoneCookie = cookieOf(phoneLogin);
  assert.equal((await raw(phonePort, { url: '/api/local-auth', headers: { host: phoneHost, cookie: phoneCookie } })).json.user.username, 'owner');
  const fromPhone = await raw(phonePort, { url: '/api/phone-access', headers: { host: phoneHost, cookie: phoneCookie } });
  assert.equal(fromPhone.json.fromPhone, true);
  const phoneSwitch = await raw(phonePort, { method: 'PUT', url: '/api/phone-access', headers: { host: phoneHost, origin: `http://${phoneHost}`, cookie: phoneCookie }, body: { enabled: false } });
  assert.equal(phoneSwitch.status, 403, phoneSwitch.text + ' ' + 'A phone must not be able to switch phone access off or on.');

  // Folder choices and recovery are for the shop computer only.
  const phoneHeaders = { host: phoneHost, origin: `http://${phoneHost}`, cookie: phoneCookie };
  assert.equal((await raw(phonePort, { method: 'PUT', url: '/api/backup', headers: phoneHeaders, body: { folder: dataDirectory } })).status, 403);
  assert.equal((await raw(phonePort, { url: '/api/backup-restore', headers: phoneHeaders })).status, 403);
  assert.equal((await raw(phonePort, { method: 'POST', url: '/api/backup-restore', headers: phoneHeaders, body: { file: 'x' } })).status, 403);

  // Phone-listener safeguards: other sites, public names and cross-site requests are refused.
  assert.equal((await raw(phonePort, { url: '/', headers: { host: 'billing.example.com' } })).status, 403);
  const crossOrigin = await raw(phonePort, { method: 'POST', url: '/api/local-auth', headers: { host: phoneHost, origin: 'http://evil.example' }, body: { action: 'login', username: 'owner', password: 'password one' } });
  assert.equal(crossOrigin.status, 403);
  const crossSite = await raw(phonePort, { method: 'POST', url: '/api/local-auth', headers: { host: phoneHost, 'sec-fetch-site': 'cross-site' }, body: { action: 'login', username: 'owner', password: 'password one' } });
  assert.equal(crossSite.status, 403);

  // The normal listener never lets a client claim to be a phone: the claim is discarded, so nothing changes.
  const claim = { host: phoneHost, 'x-billing-phone': 'a'.repeat(64) };
  const claimed = await raw(port, { url: '/api/phone-access', headers: { ...claim, cookie: ownerCookie } });
  assert.equal(claimed.json.fromPhone, false, 'A guessed phone header must not make a request look like it came from a phone.');
  // ...and on the phone listener a guessed header is replaced, so it grants nothing beyond a normal phone request.
  assert.equal((await raw(phonePort, { url: '/api/profile?account=1', headers: { host: phoneHost, 'x-billing-phone': 'b'.repeat(64) } })).status, 401);

  // The administrator turns it off; the phone port closes and phone sessions stop working there.
  const turnedOff = await raw(port, { method: 'PUT', url: '/api/phone-access', headers: { cookie: ownerCookie }, body: { enabled: false } });
  assert.equal(turnedOff.json.enabled, false);
  await waitFor(async () => !(await phoneUp()), 'The phone listener did not stop.');
  console.log('Phone access verified: off by default, administrator-only switch, private-network listener, sign-in from a phone, cross-site and spoofing refusals, and shut-off.');
} finally {
  server.stop();
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await probeServer(server.origin, dataDirectory, true) === 'stopped') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await rm(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
