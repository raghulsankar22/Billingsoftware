import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
const base = process.env.BILLING_TEST_URL || 'http://127.0.0.1:3111';
async function api(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json();
  assert.ok(response.ok, payload.error);
  return payload;
}
// Run only against a server using a disposable LOCAL_DATA_DIR.
for (const account of [1, 2, 3]) {
  assert.equal((await api(`/api/profile?account=${account}`)).profile, null, 'Use a disposable empty data directory');
}
await api('/api/profile', 'POST', { businessName: 'Local verification', address: '123 Test Street', phone: '1234567890', nextBillNumber: 100 });
const input = { billDate: '2026-10-03', customerName: 'Test customer', fatherName: 'Test parent', address: '123 Test Street', phone: '1234567890', items: [{ particulars: 'Test ring', grams: 1, assessedValue: 100, loanAmount: 80 }] };
const issued = (await api('/api/bills', 'POST', input)).bill;
assert.equal(issued.billNumber, 100);
assert.equal(issued.excelSyncStatus, 'synced');
const pdf = await fetch(`${base}/api/bills/${issued.id}/pdf`);
assert.equal(pdf.status, 200);
assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
const replaced = (await api(`/api/bills/${issued.id}/replace`, 'POST', input)).bill;
assert.equal(replaced.billNumber, 101);
assert.equal(replaced.replacementForId, issued.id);
await api(`/api/bills/${replaced.id}/void`, 'POST');
const history = await api('/api/bills?q=Test');
assert.equal(history.bills.length, 2);
assert.ok(history.bills.every(bill => bill.status === 'void'));
const excel = await fetch(`${base}/api/reports/excel`);
assert.equal(excel.status, 200);
assert.equal(Buffer.from(await excel.arrayBuffer()).subarray(0, 2).toString(), 'PK');
const rejected = await fetch(`${base}/api/profile`, { method: 'POST', headers: { origin: 'https://unrelated.example', 'content-type': 'application/json' }, body: '{}' });
assert.equal(rejected.status, 400);

for (const [account, startingNumber] of [[2, 1], [3, 500]]) {
  await api(`/api/profile?account=${account}`, 'POST', {
    businessName: `Local verification ${account}`,
    address: `${account} Test Street`,
    phone: '1234567890',
    nextBillNumber: startingNumber,
  });
  const bill = (await api(`/api/bills?account=${account}`, 'POST', {
    ...input,
    customerName: `Account ${account} customer`,
  })).bill;
  assert.equal(bill.billNumber, startingNumber);
  assert.equal(bill.excelSyncStatus, 'synced');
  const accountHistory = await api(`/api/bills?account=${account}`);
  assert.equal(accountHistory.bills.length, 1);
  assert.equal(accountHistory.bills[0].customerName, `Account ${account} customer`);
  assert.equal((await fetch(`${base}/api/bills/${issued.id}/pdf?account=${account}`)).status, 400);
  assert.equal((await fetch(`${base}/api/bills/${issued.id}/void?account=${account}`, { method: 'POST' })).status, 400);

  const register = await fetch(`${base}/api/reports/excel?account=${account}`);
  assert.equal(register.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await register.arrayBuffer()));
  const rows = workbook.getWorksheet('Bills');
  assert.ok(rows);
  assert.equal(rows.getRow(2).getCell(4).value, startingNumber);
  assert.equal(rows.getRow(2).getCell(6).value, `Account ${account} customer`);
  assert.equal(rows.getRow(3).getCell(4).value, null);
}
console.log('Local HTTP flow passed: three account profiles, independent numbers and Excel reports, PDF, replacement, void, history, and cross-origin rejection.');
