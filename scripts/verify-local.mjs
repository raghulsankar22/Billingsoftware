import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
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
const savedCustomer = (await api('/api/customers', 'POST', { name: 'Test customer', fatherName: 'Test parent', address: '123 Test Street', phone: '+91 12345 67890', aadhaar: '1234 1234 1234' })).customer;
assert.equal(savedCustomer.phone, '1234567890');
assert.equal((await api('/api/customers?phone=1234567890')).customer.id, savedCustomer.id);
assert.equal((await api('/api/customers?aadhaar=1234-1234-1234')).customer.id, savedCustomer.id);
assert.equal((await api('/api/customers?q=Test%20parent')).customers.length, 1);
const reusedCustomer = await api('/api/customers', 'POST', savedCustomer);
assert.equal(reusedCustomer.customer.id, savedCustomer.id);
assert.ok(savedCustomer.customerCode);
assert.equal((await api('/api/customers?account=2&phone=1234567890')).customer.customerCode, savedCustomer.customerCode);
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
const combined = (await api('/api/bills', 'POST', { ...input, deliveryNo: '', deliveryDate: '', items: [{ ...input.items[0], particulars: 'Ring 2, Studs 1' }] })).bill;
assert.equal(combined.items.length, 1);
assert.equal(combined.items[0].particulars, 'Ring 2, Studs 1');
assert.equal(combined.totalLoanAmount, 80);
const combinedEdit = (await api(`/api/bills/${combined.id}`, 'PATCH', { ...input, deliveryNo: '', deliveryDate: '', items: [{ ...input.items[0], particulars: 'Ring 3, Studs 1, Necklace 1' }] })).bill;
assert.equal(combinedEdit.billNumber, combined.billNumber);
assert.equal(combinedEdit.items[0].particulars, 'Ring 3, Studs 1, Necklace 1');
const combinedWorkbook = new ExcelJS.Workbook();
await combinedWorkbook.xlsx.load(Buffer.from(await (await fetch(base + '/api/reports/excel')).arrayBuffer()));
const combinedRows = combinedWorkbook.getWorksheet('Bills');
let combinedFound = false;
combinedRows.eachRow(row => { if (row.getCell(4).value === combined.billNumber) { assert.match(row.getCell(7).value, /Ring 3, Studs 1, Necklace 1/); assert.equal(row.getCell(9).value, 80); combinedFound = true; } });
assert.ok(combinedFound);
assert.equal((await fetch(`${base}/api/bills/${combined.id}/pdf`)).status, 200);
const originalProfiles = (await api('/api/profile')).profiles;
const newAccountDetails = { businessName: 'Additional Test Finance', address: '456 Test Street', phone: '1234567890', licenseNumber: 'TEST-LIC-4' };
const fourth = (await api('/api/accounts', 'POST', newAccountDetails)).profile;
const fifth = (await api('/api/accounts', 'POST', { ...newAccountDetails, businessName: 'Another Test Finance' })).profile;
assert.equal(fourth.account_slot, 4); assert.equal(fifth.account_slot, 5); assert.notEqual(fourth.id, fifth.id);
assert.equal(fourth.next_bill_number, 1); assert.equal(fourth.next_delivery_number, 1);
const batchInputs = [['Gold', 10000], ['Silver', 2000], ['Gold', 5000]];
const batchLoans = [];
for (const [metal, loanAmount] of batchInputs) batchLoans.push((await api('/api/bills?account=4', 'POST', { ...input, billDate: '2026-10-28', deliveryNo: '', deliveryDate: '', items: [{ metal, particulars: 'Batch jewellery', grams: 3, assessedValue: loanAmount * 2, loanAmount }] })).bill);
assert.deepEqual(batchLoans.map(bill => bill.billNumber), [1, 2, 3]);
const fifthBill = (await api('/api/bills?account=5', 'POST', { ...input, deliveryNo: '', deliveryDate: '' })).bill;
assert.equal(fifthBill.billNumber, 1);
await api(`/api/bills/${batchLoans[1].id}/void?account=4`, 'POST');
const batchBody = { deliveryDate: '2026-11-29', deliveries: batchLoans.map(bill => ({ billId: bill.id })) };
const invalidBatch = body => fetch(base + '/api/delivery/batch?account=4', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
assert.equal((await invalidBatch({ ...batchBody, deliveries: [{ billId: batchLoans[0].id }, { billId: fifthBill.id }] })).status, 400);
assert.equal((await invalidBatch({ ...batchBody, deliveries: [{ billId: batchLoans[0].id }, { billId: batchLoans[0].id }] })).status, 400);
assert.ok((await api('/api/bills?account=4')).bills.every(bill => !bill.deliveryNo));
assert.equal((await api('/api/delivery?billNumber=1&account=4')).nextDeliveryNumber, 1);
const batchResult = await api('/api/delivery/batch?account=4', 'POST', batchBody);
assert.deepEqual(batchResult.bills.map(bill => bill.deliveryNo), ['1', '2', '3']);
assert.deepEqual(batchResult.bills.map(bill => bill.deliverySummary.interest), [200, 60, 125]);
assert.equal(batchResult.bills.reduce((total, bill) => total + bill.deliverySummary.principal, 0), 17000);
assert.equal(batchResult.bills.reduce((total, bill) => total + bill.deliverySummary.total, 0), 17385);
assert.equal(batchResult.bills[1].status, 'void');
for (const bill of batchResult.bills) {
  const individualReceipt = await fetch(`${base}/api/bills/${bill.id}/delivery/pdf?account=4`);
  assert.equal(individualReceipt.status, 200);
  assert.equal(Buffer.from(await individualReceipt.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
}
assert.deepEqual((await api('/api/delivery/batch?account=4', 'POST', batchBody)).bills.map(bill => bill.deliveryNo), ['1', '2', '3']);
assert.equal((await api('/api/delivery?billNumber=1&account=4')).nextDeliveryNumber, 4);
const register4 = (await api('/api/reports/excel?account=4', 'POST')).savedTo;
const batchBook = new ExcelJS.Workbook(); await batchBook.xlsx.readFile(register4);
for (const row of [2, 3, 4]) { assert.equal(batchBook.getWorksheet('Bills').getCell(`A${row}`).value, String(row - 1)); assert.equal(batchBook.getWorksheet('Bills').getCell(`B${row}`).value, '2026-11-29'); }
assert.ok(!(await api('/api/bills?account=5')).bills[0].deliveryNo);
assert.deepEqual((await api('/api/profile')).profiles.filter(profile => profile.account_slot <= 3), originalProfiles);
// Simulate a blocked Excel target in this disposable test directory. Delivery records must survive.
const fourthLoan = (await api('/api/bills?account=4', 'POST', { ...input, billDate: '2026-10-28', deliveryNo: '', deliveryDate: '' })).bill;
const retryBody = { deliveryDate: '2026-11-29', deliveries: [{ billId: fourthLoan.id }] };
await fs.rename(register4, register4 + '.test-backup'); await fs.mkdir(register4);
try {
  const blocked = await api('/api/delivery/batch?account=4', 'POST', retryBody);
  assert.equal(blocked.bills[0].deliveryNo, '4'); assert.equal(blocked.bills[0].excelSyncStatus, 'failed'); assert.ok(blocked.warnings.length > 0);
} finally { await fs.rmdir(register4); await fs.rename(register4 + '.test-backup', register4); }
const recovered = await api('/api/delivery/batch?account=4', 'POST', retryBody);
assert.equal(recovered.bills[0].deliveryNo, '4'); assert.equal(recovered.bills[0].excelSyncStatus, 'synced');
assert.equal((await api('/api/delivery?billNumber=1&account=4')).nextDeliveryNumber, 5);
// Release checks for the shared customer and owner-wide search features.
assert.equal((await api('/api/customers?account=5&phone=1234567890')).customer.customerCode, savedCustomer.customerCode);
const sharedSearch = await api(`/api/search?q=${encodeURIComponent(savedCustomer.customerCode)}`);
assert.ok(sharedSearch.results.some(result => result.accountSlot === 4));
assert.ok(sharedSearch.results.some(result => result.accountSlot === 5));
for (const term of ['customer', 'Test Street', '1234567890']) {
  assert.ok((await api(`/api/search?q=${encodeURIComponent(term)}`)).total > 0);
}
const priorYearInput = { ...input, customerId: savedCustomer.id, billDate: '2025-10-31', deliveryNo: '', deliveryDate: '' };
const overdueLoan = (await api('/api/bills?account=5', 'POST', priorYearInput)).bill;
const overdueHistory = await api('/api/bills?account=5&from=2025-10-01&to=2025-10-31');
assert.ok(overdueHistory.bills.some(bill => bill.id === overdueLoan.id && !bill.deliveryNo && !bill.deliveryDate));
assert.equal(overdueLoan.customerCode, savedCustomer.customerCode);
const idSearch = await api(`/api/search?q=${encodeURIComponent(savedCustomer.customerCode)}`);
assert.ok(idSearch.results.some(result => result.bill.id === overdueLoan.id && result.accountSlot === 5));
console.log('Local HTTP flow passed: shared customers and IDs, all-account search, prior-year bill filtering, account numbering/Excel, PDFs, atomic multi-delivery, interest and safe Excel retries.');
