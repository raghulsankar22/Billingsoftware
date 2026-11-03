import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
assert.deepEqual(await api('/api/customers?phone=1234567890'), { customer: null, matches: [savedCustomer] });
assert.equal((await api('/api/customers?aadhaar=1234-1234-1234')).customer.id, savedCustomer.id);
assert.equal((await api('/api/customers?q=Test%20parent')).customers.length, 1);
const reusedCustomer = await api('/api/customers', 'POST', savedCustomer);
assert.equal(reusedCustomer.customer.id, savedCustomer.id);
assert.ok(savedCustomer.customerCode);
assert.deepEqual(await api('/api/customers?account=2&phone=1234567890'), { customer: null, matches: [savedCustomer] });
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
  if (account === 2) {
    const unanswered = await fetch(`${base}/api/bills?account=2`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, customerName: 'Account 2 customer' }) });
    assert.equal(unanswered.status, 400);
    assert.match((await unanswered.json()).error, /different person/);
  }
  const bill = (await api(`/api/bills?account=${account}`, 'POST', {
    ...input,
    customerName: `Account ${account} customer`,
    phone: account === 3 ? '' : '9000000002',
    deliveryNo: account === 3 ? '' : input.deliveryNo,
    deliveryDate: account === 3 ? '' : input.deliveryDate,
  })).bill;
  assert.equal(bill.billNumber, 1);
  assert.equal(bill.phone, account === 3 ? '' : '9000000002');
  assert.equal(Boolean(bill.customerCode), account !== 3);
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
  assert.equal(rows.getRow(2).getCell(8).value, account === 3 ? null : '9000000002');
  assert.equal(rows.getRow(2).getCell(9).value, 80);
  assert.equal(rows.getRow(2).getCell(9).numFmt, '"₹" #,##0.00');
  assert.equal(rows.getRow(3).getCell(4).value, null);
}
const combinedResponse = await fetch(`${base}/api/reports/excel?scope=all&account=2&from=2099-01-01`);
assert.equal(combinedResponse.status, 200);
const combinedRegister = new ExcelJS.Workbook();
await combinedRegister.xlsx.load(Buffer.from(await combinedResponse.arrayBuffer()));
assert.deepEqual(combinedRegister.worksheets.map(sheet => sheet.name), ['Account 1', 'Account 2', 'Account 3']);
for (const account of [2, 3]) assert.equal(combinedRegister.getWorksheet('Account ' + account).getCell('F2').value, 'Account ' + account + ' customer');
assert.equal((await api('/api/reports/excel?scope=all&account=3', 'POST')).ok, true);
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
const deliveryInput = { deliveryDate: '2026-10-28', billReceiptStatus: 'has_bill', collectedByRelation: 'self' };
const earlyDelivery = await fetch(base + '/api/bills/' + restarted.id + '/delivery', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...deliveryInput, deliveryDate: '2026-10-02' }) });
assert.equal(earlyDelivery.status, 400);
assert.match((await earlyDelivery.json()).error, /before.*bill date/i);
assert.equal((await api('/api/delivery?billNumber=1')).nextDeliveryNumber, 1);
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
assert.equal((await fetch(`${base}/api/bills/${restarted.id}/delivery`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deliveryDate: '2026-10-29', billReceiptStatus: 'lost_bill', collectedByRelation: 'self' }) })).status, 400, 'A lost bill needs the signed declaration');
await api(`/api/bills/${restarted.id}/delivery`, 'PATCH', { deliveryDate: '2026-10-29', billReceiptStatus: 'lost_bill', lostBillDeclarationSigned: true, collectedByRelation: 'self' });
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
const missingReceiptChoice = await fetch(`${base}/api/bills/${collectionLoan.id}/delivery`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deliveryDate: '2026-11-29' }) });
assert.equal(missingReceiptChoice.status, 400);
const collectionDelivery = await api(`/api/bills/${collectionLoan.id}/delivery`, 'PATCH', { deliveryDate: '2026-11-29', billReceiptStatus: 'has_bill', collectedByRelation: 'self' });
assert.equal(collectionDelivery.bill.deliveryBillReceiptStatus, 'has_bill');
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
const combined = (await api('/api/bills', 'POST', { ...input, deliveryNo: '', deliveryDate: '', items: [{ ...input.items[0], particulars: 'Ring 2, Studs 1', remarks: 'Slightly bent; missing stone' }] })).bill;
assert.equal(combined.items[0].remarks, 'Slightly bent; missing stone');
assert.equal(combined.items.length, 1);
assert.equal(combined.items[0].particulars, 'Ring 2, Studs 1');
assert.equal(combined.totalLoanAmount, 80);
const combinedEdit = (await api(`/api/bills/${combined.id}`, 'PATCH', { ...input, deliveryNo: '', deliveryDate: '', items: [{ ...input.items[0], particulars: 'Ring 3, Studs 1, Necklace 1', remarks: 'No screw' }] })).bill;
assert.equal(combinedEdit.items[0].remarks, 'No screw');
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
const batchBody = { deliveryDate: '2026-11-29', deliveries: batchLoans.map((bill, index) => ({ billId: bill.id, billReceiptStatus: index === 1 ? 'lost_bill' : 'has_bill', ...(index === 1 ? { lostBillDeclarationSigned: true } : {}), collectedByRelation: 'self' })) };
const invalidBatch = body => fetch(base + '/api/delivery/batch?account=4', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
assert.equal((await invalidBatch({ ...batchBody, deliveries: [{ billId: batchLoans[0].id, billReceiptStatus: 'has_bill', collectedByRelation: 'self' }, { billId: fifthBill.id, billReceiptStatus: 'has_bill', collectedByRelation: 'self' }] })).status, 400);
assert.equal((await invalidBatch({ ...batchBody, deliveries: [{ billId: batchLoans[0].id, billReceiptStatus: 'has_bill', collectedByRelation: 'self' }, { billId: batchLoans[0].id, billReceiptStatus: 'has_bill', collectedByRelation: 'self' }] })).status, 400);
assert.equal((await invalidBatch({ ...batchBody, deliveries: [batchBody.deliveries[0], { billId: batchLoans[1].id }] })).status, 400);
assert.ok((await api('/api/bills?account=4')).bills.every(bill => !bill.deliveryNo));
assert.equal((await api('/api/delivery?billNumber=1&account=4')).nextDeliveryNumber, 1);
const batchResult = await api('/api/delivery/batch?account=4', 'POST', batchBody);
assert.deepEqual(batchResult.bills.map(bill => bill.deliveryBillReceiptStatus), ['has_bill', 'lost_bill', 'has_bill']);
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
const retryBody = { deliveryDate: '2026-11-29', deliveries: [{ billId: fourthLoan.id, billReceiptStatus: 'lost_bill', lostBillDeclarationSigned: true, collectedByRelation: 'self' }] };
await fs.rename(register4, register4 + '.test-backup'); await fs.mkdir(register4);
try {
  const blocked = await api('/api/delivery/batch?account=4', 'POST', retryBody);
  assert.equal(blocked.bills[0].deliveryNo, '4'); assert.equal(blocked.bills[0].excelSyncStatus, 'failed'); assert.ok(blocked.warnings.length > 0);
} finally { await fs.rmdir(register4); await fs.rename(register4 + '.test-backup', register4); }
const recovered = await api('/api/delivery/batch?account=4', 'POST', retryBody);
assert.equal(recovered.bills[0].deliveryNo, '4'); assert.equal(recovered.bills[0].excelSyncStatus, 'synced');
assert.equal((await api('/api/delivery?billNumber=1&account=4')).nextDeliveryNumber, 5);
const cancelLoan = (await api('/api/bills?account=4', 'POST', { ...input, deliveryNo: '', deliveryDate: '' })).bill;
const toCancel = (await api(`/api/bills/${cancelLoan.id}/delivery?account=4`, 'PATCH', { deliveryDate: '2026-11-29', billReceiptStatus: 'has_bill', collectedByRelation: 'son', collectedByName: 'Test Son' })).bill;
assert.equal(toCancel.deliveryCollectedByName, 'Test Son');
const cancelledDelivery = await api(`/api/bills/${cancelLoan.id}/delivery?account=4`, 'DELETE');
assert.ok(!cancelledDelivery.bill.deliveryNo); assert.ok(!cancelledDelivery.bill.deliveryDate); assert.equal(cancelledDelivery.bill.cancelledDeliveries[0].deliveryNo, toCancel.deliveryNo); assert.equal(cancelledDelivery.bill.excelSyncStatus, 'synced');
assert.equal((await api('/api/delivery?billNumber=1&account=4')).nextDeliveryNumber, Number(toCancel.deliveryNo) + 1);
const cancelRegister = new ExcelJS.Workbook();
await cancelRegister.xlsx.load(Buffer.from(await (await fetch(`${base}/api/reports/excel?account=4`)).arrayBuffer()));
let cancelRow; cancelRegister.getWorksheet('Bills').eachRow((row, index) => { if (index > 1 && row.getCell(4).value === cancelLoan.billNumber) cancelRow = row; });
assert.ok(cancelRow); assert.equal(cancelRow.getCell(1).value, null); assert.equal(cancelRow.getCell(2).value, null); assert.ok(!String(cancelRow.getCell(7).value).includes('Taken by'));
assert.equal((await fetch(`${base}/api/bills/${cancelLoan.id}/delivery?account=4`, { method: 'DELETE' })).status, 400);
// Release checks for the shared customer and owner-wide search features.
assert.deepEqual(await api('/api/customers?account=5&phone=1234567890'), { customer: null, matches: [savedCustomer] });
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
const relativeInput = { name: 'Test relative', fatherName: 'Test parent', address: '123 Test Street', phone: savedCustomer.phone, aadhaar: '' };
const unconfirmedRelative = await fetch(base + '/api/customers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(relativeInput) });
assert.equal(unconfirmedRelative.status, 409);
assert.equal((await unconfirmedRelative.json()).sharedPhone.id, savedCustomer.id);
assert.deepEqual((await api('/api/customers?phone=1234567890')).matches, [savedCustomer]);
const relative = (await api('/api/customers', 'POST', { ...relativeInput, allowSharedPhone: true })).customer;
assert.notEqual(relative.id, savedCustomer.id);
const familyLookup = await api('/api/customers?account=5&phone=1234567890');
assert.equal(familyLookup.customer, null);
assert.deepEqual(familyLookup.matches.map(customer => customer.id).sort(), [savedCustomer.id, relative.id].sort());
assert.equal((await api('/api/customers?aadhaar=123412341234')).customer.id, savedCustomer.id);

const importAccount = await api('/api/accounts', 'POST', { businessName: 'Import verification', address: '123 Test Street', phone: '1234567890' });
const importSlot = importAccount.profile.account_slot;
const importBook = new ExcelJS.Workbook();
const importSheet = importBook.addWorksheet('Bills');
importSheet.addRow(['Delivery No', 'Delivery Date', 'Date', 'Bill No', 'Address', 'Name', 'Particulars', 'Phone', 'Amount']);
importSheet.addRow(['', '', '1/4/22', 1, 'Test Street', 'Imported void', 'VOID - Ring', '', 1000]);
importSheet.addRow(['9876543210', '1/5/22', '1/4/22', 2, 'Test Street', 'Imported delivered', 'Chain', '', 2000]);
importSheet.addRow(['', '', '1/4/22', 3, 'Test Street', 'Imported waiting', 'Ring', '', 3000]);
importBook.addWorksheet('Empty');
const importBytes = await importBook.xlsx.writeBuffer();
async function uploadRegister(endpoint, metals) {
  const form = new FormData();
  form.append('file', new File([importBytes], 'sample-register.xlsx'));
  if (metals) form.append('metals', JSON.stringify(metals));
  const response = await fetch(base + '/api/' + endpoint + '?account=' + importSlot, { method: 'POST', body: form });
  return { response, data: await response.json() };
}
const importPreview = await uploadRegister('import-preview');
assert.equal(importPreview.response.status, 200);
assert.deepEqual(importPreview.data.warnings, []);
assert.deepEqual(importPreview.data.rows.flatMap(row => row.issues), []);
const incompleteImport = await uploadRegister('import-historical', { 'Bills:2': 'Gold' });
assert.equal(incompleteImport.response.status, 400);
assert.equal((await api('/api/bills?account=' + importSlot)).bills.length, 0);
const imported = await uploadRegister('import-historical', { 'Bills:2': 'Gold', 'Bills:3': 'Gold', 'Bills:4': 'Silver' });
assert.equal(imported.response.status, 201);
assert.equal(imported.data.count, 3);
assert.equal(imported.data.warning, '');
const importedBills = (await api('/api/bills?account=' + importSlot)).bills.sort((first, second) => first.billNumber - second.billNumber);
assert.deepEqual(importedBills.map(bill => bill.status), ['void', 'issued', 'issued']);
assert.equal(importedBills[1].deliveryNo, '9876543210');
assert.equal((await api('/api/delivery?account=' + importSlot + '&billNumber=3')).nextDeliveryNumber, 1);
assert.equal((await api('/api/profile?account=' + importSlot)).profile.next_bill_number, 4);
const repeatedPreview = await uploadRegister('import-preview');
assert.ok(repeatedPreview.data.rows.every(row => row.issues.includes('Bill number already exists in this account')));
const duplicateImport = await uploadRegister('import-historical', { 'Bills:2': 'Gold', 'Bills:3': 'Gold', 'Bills:4': 'Silver' });
assert.equal(duplicateImport.response.status, 400);
assert.equal((await api('/api/bills?account=' + importSlot)).bills.length, 3);
const billsBeforeCatalogueEdit = (await api('/api/bills')).bills;
assert.equal((await api('/api/jewellery?account=2', 'PATCH', { originalName: 'Ring', name: 'Runtime Edited Ring' })).name, 'Runtime Edited Ring');
assert.ok(!(await api('/api/jewellery?account=3')).items.includes('Ring'));
await api('/api/jewellery', 'DELETE', { name: 'Chain' });
assert.ok(!(await api('/api/jewellery')).items.includes('Chain'));
assert.deepEqual((await api('/api/bills')).bills, billsBeforeCatalogueEdit);
await api('/api/jewellery', 'PATCH', { originalName: 'Runtime Edited Ring', name: 'Ring' });
await api('/api/jewellery', 'POST', { name: 'Chain' });
assert.ok((await api('/api/jewellery')).items.includes('Ring'));
assert.ok((await api('/api/jewellery')).items.includes('Chain'));
// Backup and restore: copy the ledger to a folder outside the data folder, change it, then go back.
const backupFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'billing-backup-verify-'));
try {
  assert.equal((await api('/api/backup')).folder, null);
  assert.equal((await fetch(base + '/api/backup', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: 'relative/folder' }) })).status, 400);
  const firstBackup = await api('/api/backup', 'PUT', { folder: backupFolder });
  assert.equal(firstBackup.copies, 1);
  assert.equal(firstBackup.due, false);
  const billsAtBackup = (await api('/api/bills')).bills;
  await api('/api/jewellery', 'POST', { name: 'Verify After Backup' });
  assert.ok((await api('/api/jewellery')).items.includes('Verify After Backup'));
  const offered = (await api('/api/backup-restore')).backups;
  assert.equal(offered.length, 1);
  const restored = await api('/api/backup-restore', 'POST', { file: offered[0].file });
  assert.match(restored.safetyCopy, /^before-restore-/);
  assert.ok(!(await api('/api/jewellery')).items.includes('Verify After Backup'), 'Restore must bring back the backed-up catalogue');
  assert.deepEqual((await api('/api/bills')).bills, billsAtBackup);
  assert.equal((await fetch(base + '/api/backup-restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: '../billing.sqlite' }) })).status, 400);
  await api('/api/jewellery', 'POST', { name: 'Verify Saves After Restore' });
  assert.ok((await api('/api/jewellery')).items.includes('Verify Saves After Restore'));
  await api('/api/jewellery', 'DELETE', { name: 'Verify Saves After Restore' });
} finally { await fs.rm(backupFolder, { recursive: true, force: true }); }
console.log('Local HTTP flow passed: jewellery rename/delete without changing saved bills, shared-phone confirmation and selection, delivery date validation, sample register preview/import and duplicate rejection, backup and restore, shared customers and IDs, all-account search, prior-year bill filtering, account numbering/Excel, PDFs, atomic multi-delivery, interest and safe Excel retries.');
