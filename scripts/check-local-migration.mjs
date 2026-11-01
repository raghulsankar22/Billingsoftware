// Dry run only. Reads SQLite in a snapshot and prints aggregate validation;
// it never prints customer data, writes to the ledger or uploads records.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkMigrationSnapshot } from '../src/lib/migration-check.ts';

const root = resolve(process.env.LOCAL_DATA_DIR || join(process.cwd(), 'data'));
const directories = [root];
const users = join(root, 'users');
if (existsSync(users)) for (const entry of readdirSync(users, { withFileTypes: true })) {
  if (entry.isDirectory() && /^[0-9a-f-]{36}$/i.test(entry.name)) directories.push(join(users, entry.name));
}
const checks = [], ids = new Map(), collisions = [];
for (const directory of directories) {
  const filename = join(directory, 'billing.sqlite');
  if (!existsSync(filename)) continue;
  let db;
  try {
    db = new DatabaseSync(filename, { readOnly: true });
    db.exec('BEGIN');
    const read = table => db.prepare('SELECT body FROM records WHERE table_name=? ORDER BY id').all(table).map(row => JSON.parse(row.body));
    const snapshot = {
      profiles: read('business_profiles'), bills: read('bills'), items: read('bill_items'),
      customers: db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='customers'").get() ? db.prepare('SELECT * FROM customers ORDER BY id').all().map(row => ({ ...row })) : [],
    };
    const result = checkMigrationSnapshot(snapshot);
    for (const [kind, records] of Object.entries(snapshot)) for (const record of records) {
      if (typeof record.id !== 'string') continue;
      const key = `${kind}:${record.id.toLowerCase()}`;
      if (ids.has(key)) collisions.push(`Duplicate ${kind} ID across data stores`); else ids.set(key, true);
    }
    checks.push(result);
    db.exec('COMMIT');
  } catch {
    try { db?.exec('ROLLBACK'); } catch { /* No transaction to roll back. */ }
    checks.push({ ok: false, counts: null, loanPaise: null, issues: ['Unable to inspect one local data store.'] });
  } finally { db?.close(); }
}
const result = { ok: checks.length > 0 && checks.every(check => check.ok) && !collisions.length, stores: checks, issues: [...new Set(collisions)] };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 2;
