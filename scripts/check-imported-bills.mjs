// Read-only review of register-imported bills. Prints bill numbers only, never customer information.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(process.env.LOCAL_DATA_DIR || join(process.cwd(), 'data'));
const stores = [root];
const usersRoot = join(root, 'users');
if (existsSync(usersRoot)) for (const entry of readdirSync(usersRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && /^[0-9a-f-]{36}$/i.test(entry.name)) stores.push(join(usersRoot, entry.name));
}
const result = { stores: 0, importedBills: 0, voidMarkedButActive: [], unusualDeliveryNumbers: [], warnings: [] };
for (const directory of stores) {
  const path = join(directory, 'billing.sqlite');
  if (!existsSync(path)) continue;
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const bills = db.prepare("SELECT body FROM records WHERE table_name='bills' AND json_extract(body,'$.historical_import')=1").all().map(row => JSON.parse(String(row.body)));
    const items = db.prepare("SELECT body FROM records WHERE table_name='bill_items'").all().map(row => JSON.parse(String(row.body)));
    const voidMarked = new Set(items.filter(item => /^void\s*[—–-]/i.test(String(item.particulars ?? ''))).map(item => item.bill_id));
    result.stores++;
    result.importedBills += bills.length;
    for (const bill of bills) {
      if (bill.status === 'issued' && voidMarked.has(bill.id)) result.voidMarkedButActive.push(bill.bill_number);
      const number = String(bill.delivery_no ?? '');
      if (number && (!/^\d+$/.test(number) || Number(number) > 9_999_999)) result.unusualDeliveryNumbers.push(bill.bill_number);
    }
  } catch { result.warnings.push('Could not fully inspect one local data store.'); }
  finally { db?.close(); }
}
console.log(JSON.stringify(result, null, 2));
