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
const jewellery = await api('/api/jewellery');
for (const name of ['Ring', 'Necklace', 'Haram']) assert.ok(jewellery.items.includes(name));
const customJewellery = await api('/api/jewellery?account=1', 'POST', { name: '  Test   Jhumka ' });
assert.equal(customJewellery.name, 'Test Jhumka');
assert.equal((await api('/api/jewellery?account=2', 'POST', { name: 'test jhumka' })).name, 'Test Jhumka');
assert.equal((await api('/api/jewellery?account=3')).items.filter(name => name === 'Test Jhumka').length, 1);
for (const name of ['', 'X'.repeat(181), null]) {
  assert.equal((await fetch(base + '/api/jewellery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })).status, 400);
}
const rejectedJewellery = await fetch(base + '/api/jewellery', { method: 'POST', headers: { origin: 'https://unrelated.example', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Should not be saved' }) });
assert.equal(rejectedJewellery.status, 400);
assert.ok(!(await api('/api/jewellery')).items.includes('Should not be saved'));
await api('/api/profile', 'POST', { businessName: 'Local verification', address: '123 Test Street', phone: '1234567890', licenseNumber: 'TEST-LIC-1', nextBillNumber: 100 });
assert.equal((await api('/api/profile')).profile.license_number, 'TEST-LIC-1');
const input = { billDate: '2026-10-03', customerName: 'Test customer', fatherName: 'Test parent', address: '123 Test Street', phone: '1234567890', deliveryNo: 'D-01', deliveryDate: '2026-10-15', items: [{ metal: 'Gold', particulars: 'Test ring', grams: 1, assessedValue: 100, loanAmount: 80 }] };
const issued = (await api('/api/bills', 'POST', input)).bill;
assert.equal(issued.billNumber, 1);
assert.equal(issued.businessSnapshot.license_number, 'TEST-LIC-1');
assert.equal(issued.excelSyncStatus, 'synced');
const pdf = await fetch(`${base}/api/bills/${issued.id}/pdf`);
assert.equal(pdf.status, 200);
assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
const replaced = (await api(`/api/bills/${issued.id}/replace`, 'POST', input)).bill;
assert.equal(replaced.billNumber, 2);
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
    licenseNumber: `TEST-LIC-${account}`,
    nextBillNumber: startingNumber,
  });
  const bill = (await api(`/api/bills?account=${account}`, 'POST', {
    ...input,
    customerName: `Account ${account} customer`,
    phone: account === 3 ? '' : input.phone,
    deliveryNo: account === 3 ? '' : input.deliveryNo,
    deliveryDate: account === 3 ? '' : input.deliveryDate,
  })).bill;
  assert.equal(bill.billNumber, 1);
  assert.equal(bill.phone, account === 3 ? '' : input.phone);
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
  assert.equal(rows.getRow(2).getCell(4).value, 1);
  assert.equal(rows.getRow(2).getCell(6).value, `Account ${account} customer`);
  assert.equal(rows.getRow(2).getCell(1).value, account === 3 ? null : input.deliveryNo);
  assert.equal(rows.getRow(2).getCell(2).value, account === 3 ? null : input.deliveryDate);
  assert.equal(rows.getRow(2).getCell(8).value, account === 3 ? null : input.phone);
  assert.equal(rows.getRow(2).getCell(9).value, 80);
  assert.equal(rows.getRow(2).getCell(9).numFmt, '"₹" #,##0.00');
  assert.equal(rows.getRow(3).getCell(4).value, null);
}
await api(`/api/bills/${issued.id}`, 'DELETE');
await api(`/api/bills/${replaced.id}`, 'DELETE');
assert.equal((await api('/api/profile')).profile.next_bill_number, 1);
const restarted = (await api('/api/bills', 'POST', input)).bill;
assert.equal(restarted.billNumber, 1);
await api(`/api/bills/${restarted.id}`, 'PATCH', { ...input, phone: '', deliveryNo: '', deliveryDate: '' });
const refreshed = await api('/api/reports/excel', 'POST');
const saved = new ExcelJS.Workbook();
await saved.xlsx.readFile(refreshed.savedTo);
for (const cell of ['A2', 'B2', 'H2']) assert.equal(saved.getWorksheet('Bills').getCell(cell).value, null, `${cell} must stay empty after clearing and refreshing`);
assert.equal(saved.getWorksheet('Bills').getCell('I2').numFmt, '"₹" #,##0.00');
const lookup = await api('/api/delivery?billNumber=%231');
assert.equal(lookup.bill.id, restarted.id);
assert.equal(lookup.nextDeliveryNumber, 1);
assert.equal((await fetch(`${base}/api/delivery?billNumber=999`)).status, 404);
assert.equal((await fetch(`${base}/api/delivery?billNumber=1.5`)).status, 400);
const otherAccountBill = (await api('/api/delivery?billNumber=1&account=2')).bill;
assert.notEqual(otherAccountBill.id, restarted.id);
const deliveryInput = { deliveryDate: '2026-10-28' };
const wrongAccountDelivery = await fetch(`${base}/api/bills/${restarted.id}/delivery?account=2`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(deliveryInput) });
assert.equal(wrongAccountDelivery.status, 400);
const delivered = await api(`/api/bills/${restarted.id}/delivery`, 'PATCH', deliveryInput);
assert.equal(delivered.bill.id, restarted.id);
assert.equal(delivered.bill.billNumber, 1);
assert.equal(delivered.bill.deliveryNo, '1');
assert.equal(delivered.bill.deliveryDate, deliveryInput.deliveryDate);
assert.equal(delivered.bill.totalLoanAmount, 80);
assert.equal(delivered.bill.excelSyncStatus, 'synced');
assert.deepEqual(delivered.warnings, []);
await api(`/api/bills/${restarted.id}/delivery`, 'PATCH', { deliveryDate: '2026-10-29' });
assert.equal((await api('/api/bills')).bills.length, 1);
assert.equal((await api('/api/profile')).profile.next_bill_number, 2);
const deliveryWorkbook = new ExcelJS.Workbook();
await deliveryWorkbook.xlsx.readFile(refreshed.savedTo);
const deliverySheet = deliveryWorkbook.getWorksheet('Bills');
assert.equal(deliverySheet.getCell('A2').value, '1');
assert.equal(deliverySheet.getCell('B2').value, '2026-10-29');
assert.equal(deliverySheet.getCell('H2').value, null);
assert.equal(deliverySheet.getCell('I2').value, 80);
assert.equal(deliverySheet.getCell('D3').value, null);
assert.equal((await fetch(`${base}/api/bills/${restarted.id}/pdf`)).status, 200);
assert.equal((await fetch(`${base}/api/bills/${restarted.id}/delivery/pdf`)).status, 200);
await api(`/api/bills/${otherAccountBill.id}?account=2`, 'PATCH', { ...input, customerName: 'Account 2 customer', deliveryNo: '', deliveryDate: '' });
await api(`/api/bills/${otherAccountBill.id}/void?account=2`, 'POST');
const voidDelivery = await api(`/api/bills/${otherAccountBill.id}/delivery?account=2`, 'PATCH', deliveryInput);
assert.equal(voidDelivery.bill.status, 'void');
assert.equal(voidDelivery.bill.id, otherAccountBill.id);
assert.equal(voidDelivery.bill.deliveryNo, '1');
assert.equal(voidDelivery.bill.deliveryDate, deliveryInput.deliveryDate);
assert.equal(voidDelivery.bill.excelSyncStatus, 'synced');
const voidRegister = await fetch(`${base}/api/reports/excel?account=2`);
const voidWorkbook = new ExcelJS.Workbook();
await voidWorkbook.xlsx.load(Buffer.from(await voidRegister.arrayBuffer()));
const voidSheet = voidWorkbook.getWorksheet('Bills');
assert.equal(voidSheet.getCell('A2').value, '1');
assert.equal(voidSheet.getCell('B2').value, deliveryInput.deliveryDate);
assert.match(voidSheet.getCell('G2').value, /^VOID — /);
assert.equal(voidSheet.getRow(2).font.strike, true);
assert.equal((await fetch(`${base}/api/bills/${otherAccountBill.id}/pdf?account=2`)).status, 200);
assert.equal((await fetch(`${base}/api/bills/${otherAccountBill.id}/delivery/pdf?account=2`)).status, 200);
const collectionLoan = (await api('/api/bills', 'POST', { ...input, billDate: '2026-10-28', deliveryNo: '', deliveryDate: '', items: [{ metal: 'Gold', particulars: 'Collection test ring', grams: 5, assessedValue: 15000, loanAmount: 10000 }] })).bill;
const collectionDelivery = await api(`/api/bills/${collectionLoan.id}/delivery`, 'PATCH', { deliveryDate: '2026-11-29' });
assert.equal(collectionDelivery.bill.deliveryNo, '2');
assert.equal(collectionDelivery.bill.deliverySummary.principal, 10000);
assert.equal(collectionDelivery.bill.deliverySummary.initialInterest, 200);
assert.equal(collectionDelivery.bill.deliverySummary.interest, 200);
assert.equal(collectionDelivery.bill.deliverySummary.total, 10200);
assert.deepEqual(collectionDelivery.warnings, []);
const receipt = await fetch(`${base}/api/bills/${collectionLoan.id}/delivery/pdf`);
assert.equal(receipt.status, 200);
assert.equal(Buffer.from(await receipt.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
assert.equal((await fetch(`${base}/api/bills/${collectionLoan.id}/delivery/pdf?account=2`)).status, 400);
console.log('Local HTTP flow passed: per-account automatic delivery numbers, repeat saves, same-row Excel updates, voided-bill delivery, monthly collection totals, and printable delivery PDFs.');
