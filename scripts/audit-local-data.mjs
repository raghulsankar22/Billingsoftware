// Read-only inventory for migration planning. Never prints customer information.
import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(process.env.LOCAL_DATA_DIR || join(process.cwd(), 'data'));
const result = { userCount: 0, dataStores: 0, businessProfiles: 0, bills: 0, billItems: 0, customers: 0, pdfFiles: 0, excelRegisters: 0, warnings: [] };
function openReadonly(filename) { return new DatabaseSync(filename, { readOnly: true }); }
function countFiles(directory, suffix) {
  if (!existsSync(directory)) return 0;
  let count = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(join(directory, entry.name), suffix);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(suffix)) count++;
  }
  return count;
}
const usersFile = join(root, 'users.sqlite');
if (existsSync(usersFile)) {
  const users = openReadonly(usersFile);
  try { result.userCount = Number(users.prepare('SELECT count(*) AS count FROM users').get().count); }
  catch { result.warnings.push('Could not count the local users database.'); }
  finally { users.close(); }
}
const stores = [root];
const usersRoot = join(root, 'users');
if (existsSync(usersRoot)) for (const entry of readdirSync(usersRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && /^[0-9a-f-]{36}$/i.test(entry.name)) stores.push(join(usersRoot, entry.name));
}
for (const directory of stores) {
  const path = join(directory, 'billing.sqlite');
  if (!existsSync(path)) continue;
  const db = openReadonly(path);
  try {
    for (const row of db.prepare("SELECT table_name, count(*) AS count FROM records WHERE table_name IN ('business_profiles', 'bills', 'bill_items') GROUP BY table_name").all()) {
      const key = { business_profiles: 'businessProfiles', bills: 'bills', bill_items: 'billItems' }[row.table_name];
      result[key] += Number(row.count);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='customers'").get()) result.customers += Number(db.prepare('SELECT count(*) AS count FROM customers').get().count);
    result.pdfFiles += countFiles(join(directory, 'bill-pdfs'), '.pdf');
    result.excelRegisters += countFiles(join(directory, 'registers'), '.xlsx');
    result.dataStores++;
  } catch { result.warnings.push('Could not fully inspect one local data store.'); }
  finally { db.close(); }
}
console.log(JSON.stringify(result, null, 2));
