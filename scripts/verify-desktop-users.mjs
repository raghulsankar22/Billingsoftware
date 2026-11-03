import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBillingServer, probeServer } from '../desktop/server.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'tmp'), { recursive: true });
const dataDirectory = await mkdtemp(path.join(root, 'tmp/desktop-users-verification-'));
const listener = createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
process.env.BILLING_MULTI_USER = '1';
const runtimeDirectory = path.resolve(process.env.BILLING_TEST_RUNTIME_DIR || path.join(root, '.desktop-runtime'));
const server = await ensureBillingServer({ runtimeDirectory, dataDirectory, port });
async function request(url, method = 'GET', body, cookie) {
  const response = await fetch(server.origin + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json(); return { response, data };
}
const session = result => result.response.headers.get('set-cookie').split(';')[0];
try {
  assert.ok(server.owned);
  assert.equal((await request('/api/profile?account=1')).response.status, 401);
  const owner = await request('/api/local-auth', 'POST', { action: 'setup', username: 'owner', password: 'password one' });
  assert.equal(owner.response.status, 200); assert.equal(owner.data.user.administrator, true);
  const ownerCookie = session(owner);
  assert.equal((await request('/api/profile?account=1', 'POST', { businessName: 'Owner test', address: '123 Test Road', phone: '1234567890' }, ownerCookie)).response.status, 200);
  assert.equal((await request('/api/local-auth', 'POST', { action: 'create', username: 'father', password: 'password two' }, ownerCookie)).response.status, 200);
  assert.equal((await request('/api/local-auth', 'POST', { action: 'create-with-admin', adminUsername: 'owner', adminPassword: 'wrong password', username: 'mother', password: 'password three' })).response.status, 400);
  assert.equal((await request('/api/local-auth', 'POST', { action: 'create-with-admin', adminUsername: 'owner', adminPassword: 'password one', username: 'mother', password: 'password three' })).response.status, 200);
  assert.equal((await request('/api/local-auth', 'POST', { action: 'login', username: 'mother', password: 'password three' })).response.status, 200);
  const father = await request('/api/local-auth', 'POST', { action: 'login', username: 'father', password: 'password two' });
  assert.equal(father.response.status, 200); const fatherCookie = session(father);
  assert.equal((await request('/api/profile?account=1', 'GET', undefined, fatherCookie)).data.profile, null);
  assert.equal((await request('/api/profile?account=1', 'POST', { businessName: 'Father test', address: '456 Test Road', phone: '1234567890' }, fatherCookie)).response.status, 200);
  assert.equal((await request('/api/profile?account=1', 'GET', undefined, ownerCookie)).data.profile.business_name, 'Owner test');
  assert.equal((await request('/api/profile?account=1', 'GET', undefined, fatherCookie)).data.profile.business_name, 'Father test');
  assert.equal((await request('/api/profile?account=2', 'POST', { businessName: 'Empty account', address: '123 Test Road', phone: '1234567890' }, ownerCookie)).response.status, 200);
  const sampleBill = { billDate: '2024-01-01', customerName: 'Owner-only Customer', fatherName: 'Sample Parent', address: 'Sample Address', phone: '', items: [{ metal: 'Gold', particulars: 'Ring 2', grams: 2, assessedValue: 100, loanAmount: 80 }] };
  assert.equal((await request('/api/bills?account=1', 'POST', sampleBill, ownerCookie)).response.status, 201);
  assert.equal((await request('/api/bills?account=1', 'POST', { ...sampleBill, customerName: 'Father-only Customer' }, fatherCookie)).response.status, 201);
  for (const [cookie, expectedSheets, customer] of [[ownerCookie, ['Account 1', 'Account 2'], 'Owner-only Customer'], [fatherCookie, ['Account 1'], 'Father-only Customer']]) {
    const download = await fetch(server.origin + '/api/reports/excel?scope=all', { headers: { cookie } });
    assert.equal(download.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await download.arrayBuffer()));
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), expectedSheets);
    assert.equal(workbook.getWorksheet('Account 1').getCell('F2').value, customer);
    assert.equal((await request('/api/reports/excel?scope=all', 'POST', undefined, cookie)).response.status, 200);
  }
  assert.equal((await request('/api/reports/excel?scope=all')).response.status, 401);
  assert.equal((await request('/api/local-auth', 'POST', { action: 'change-password', currentPassword: 'password two', newPassword: 'new password' }, fatherCookie)).response.status, 200);
  assert.equal((await request('/api/profile?account=1', 'GET', undefined, fatherCookie)).response.status, 401);
  assert.equal((await request('/api/local-auth', 'POST', { action: 'login', username: 'father', password: 'new password' })).response.status, 200);
  const backupFolder = await mkdtemp(path.join(root, 'tmp/desktop-backup-verification-'));
  if (path.dirname(backupFolder) !== path.join(root, 'tmp') || !path.basename(backupFolder).startsWith('desktop-backup-verification-')) throw new Error('Invalid backup verification directory');
  try {
    assert.equal((await request('/api/backup', 'PUT', { folder: backupFolder }, ownerCookie)).response.status, 200);
    const offered = await request('/api/backup-restore', 'GET', undefined, ownerCookie);
    assert.equal(offered.response.status, 200); assert.equal(offered.data.backups.length, 1);
    const file = offered.data.backups[0].file;
    const preview = await request('/api/backup-restore?file=' + encodeURIComponent(file), 'GET', undefined, ownerCookie);
    assert.equal(preview.response.status, 200); assert.equal(preview.data.preview.format, 'complete');
    assert.equal(preview.data.preview.userCount, 3); assert.equal(preview.data.preview.billCount, 2); assert.equal(preview.data.preview.ledgerCount, 2);
    const history = await request('/api/bill-history?account=1', 'GET', undefined, ownerCookie);
    assert.equal(history.response.status, 200); assert.equal(history.data.total, 1);
    assert.equal(history.data.entries[0].actor, 'owner'); assert.ok(!JSON.stringify(history.data).includes(sampleBill.customerName));
    assert.equal((await request('/api/jewellery', 'POST', { name: 'After Backup Only' }, ownerCookie)).response.status, 200);
    assert.equal((await request('/api/backup-restore', 'POST', { file, currentPassword: 'wrong' }, ownerCookie)).response.status, 400);
    const restored = await request('/api/backup-restore', 'POST', { file, currentPassword: 'password one' }, ownerCookie);
    assert.equal(restored.response.status, 200); assert.equal(restored.data.restartRequired, true); assert.match(restored.data.safetyCopy, /^before-restore-/);
    assert.equal((await request('/api/profile', 'GET', undefined, ownerCookie)).response.status, 401);
    const reopened = await request('/api/local-auth', 'POST', { action: 'login', username: 'owner', password: 'password one' });
    assert.equal(reopened.response.status, 200); const restoredCookie = session(reopened);
    assert.ok(!(await request('/api/jewellery', 'GET', undefined, restoredCookie)).data.items.includes('After Backup Only'));
    const restoredHistory = await request('/api/bill-history?account=1', 'GET', undefined, restoredCookie);
    assert.equal(restoredHistory.data.entries[0].action, 'Backup restored');
    assert.equal((await request('/api/bills?account=1', 'GET', undefined, restoredCookie)).data.bills.length, 1);
    assert.equal((await request('/api/local-auth', 'POST', { action: 'login', username: 'father', password: 'new password' })).response.status, 200);
  } finally { await rm(backupFolder, { recursive: true, force: true }); }
  console.log('Packaged offline server verified: sign-in, isolated accounts, password changes, history and complete administrator backup/recovery.');
} finally {
  server.stop();
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await probeServer(server.origin, dataDirectory) === 'stopped') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (await probeServer(server.origin, dataDirectory) !== 'stopped') throw new Error('Desktop verification server did not stop.');
}
