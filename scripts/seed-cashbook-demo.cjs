const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'tmp', 'cashbook-website-demo');

async function main() {
  if (process.env.LOCAL_DATA_DIR && path.resolve(process.env.LOCAL_DATA_DIR) !== directory) throw new Error('Remove the LOCAL_DATA_DIR override. This script only initializes synthetic cash-book data.');
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  if (fs.realpathSync(path.join(root, 'tmp')) !== path.join(root, 'tmp')) throw new Error('The sample parent cannot be a linked directory.');
  const marker = path.join(directory, '.cashbook-demo');
  const loginFile = path.join(directory, '.demo-login.json');
  if (fs.existsSync(directory)) {
    if (fs.realpathSync(directory) !== directory || fs.readFileSync(marker, 'utf8') !== 'synthetic-cashbook-preview-v1' || !fs.existsSync(loginFile)) throw new Error('An incomplete or unmarked sample folder already exists. It has not been changed.');
    console.log('Synthetic cash-book sample is already initialized. Login is in the ignored sample folder.'); return;
  }
  fs.mkdirSync(directory); fs.writeFileSync(marker, 'synthetic-cashbook-preview-v1', { flag: 'wx' });
  process.env.NEXT_PUBLIC_BILLING_STORAGE = 'local'; process.env.BILLING_MULTI_USER = '1'; process.env.LOCAL_DATA_DIR = directory; process.env.BILLING_CASHBOOK_PREVIEW = '1';
  require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  const { createLocalUsers } = require('../src/lib/local-users.ts');
  const { createLocalDatabase } = require('../src/lib/local-database.ts');
  const { billingToday } = require('../src/lib/business-updates.ts');
  const today = billingToday();
  const earlier = days => { const date = new Date(today + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() - days); return date.toISOString().slice(0, 10); };
  const username = 'cashdemo'; const password = 'Demo-' + randomBytes(6).toString('hex');
  const users = createLocalUsers(directory);
  try { await users.create(username, password); } finally { users.close(); }
  const database = createLocalDatabase(directory);
  try {
    const rpc = async (name, parameters) => { const result = await database.rpc(name, { p_owner_id: 'local-owner', ...parameters }); if (result.error) throw result.error; return result.data; };
    const post = (account, body) => database.cashBook.post(account, { operationId: randomUUID(), date: today, ...body });
    for (const account of [1, 2]) {
      await rpc('save_business_profile', { p_profile: { businessName: 'SAMPLE Finance ' + account, address: '123 Sample Street', phone: '1234567890', accountSlot: account, nextBillNumber: 1 } });
      post(account, { action: 'opening', date: earlier(2), amount: account === 1 ? 20000 : 15000 });
      for (let index = 0; index < 3; index++) {
        const created = await rpc('create_bill', { p_bill: { accountSlot: account, billDate: index === 2 ? today : earlier(2), customerName: 'Sample Customer ' + account + '-' + (index + 1), fatherName: 'Sample Parent', address: '123 Sample Street', phone: '', items: [{ metal: 'Gold', particulars: 'Ring', grams: 2, assessedValue: 2000, loanAmount: 1000 }] } });
        if (index < 2) post(account, { action: 'entry', date: earlier(2), kind: 'disbursement', method: 'cash', amount: 1000, billId: created.id, note: 'Synthetic confirmed payout' });
        if (index < 2) await rpc('record_bill_delivery', { p_bill_id: created.id, p_account_slot: account, p_delivery: { deliveryDate: today, billReceiptStatus: 'has_bill', collectedByRelation: 'self' } });
        if (index === 0) {
          const bill = database.cashBook.view(account, today).accounts[0].bills.find(bill => bill.id === created.id);
          post(account, { action: 'entry', kind: 'collection', method: account === 1 ? 'cash' : 'upi', amount: 1000 + bill.expectedInterest, principal: 1000, interest: bill.expectedInterest, discount: 0, billId: created.id, note: 'Synthetic confirmed receipt' });
        }
      }
      const previous = database.cashBook.view(account, earlier(1)).accounts[0];
      post(account, { action: 'close', date: earlier(1), countedCash: previous.expectedCash, revision: previous.revision, note: '', acknowledgeUnrecorded: true });
      post(account, { action: 'entry', kind: 'expense', method: 'cash', amount: 75, note: 'Sample stationery expense' });
    }
    post(1, { action: 'entry', kind: 'cash_in', method: 'cash', amount: 500, note: 'Sample owner cash introduction' });
    fs.writeFileSync(loginFile, JSON.stringify({ username, password }, null, 2), { flag: 'wx' });
    console.log('Created fictional sample accounts and confirmed money entries. No real data was read or copied.');
  } finally { database.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
