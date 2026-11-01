import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("checks a local snapshot without writing the ledger or printing personal details", () => {
  const directory = mkdtempSync(join(tmpdir(), "billing-migration-check-"));
  const filename = join(directory, "billing.sqlite");
  try {
    const db = new DatabaseSync(filename);
    db.exec("CREATE TABLE records (id TEXT PRIMARY KEY, table_name TEXT, body TEXT); CREATE TABLE customers (id TEXT, profile_id TEXT, customer_number INTEGER, canonical_id TEXT, name TEXT);");
    const insert = db.prepare("INSERT INTO records VALUES(?,?,?)");
    const profileId = randomUUID(), billId = randomUUID(), itemId = randomUUID(), customerId = randomUUID();
    insert.run(profileId, "business_profiles", JSON.stringify({ id: profileId, account_slot: 1 }));
    insert.run(billId, "bills", JSON.stringify({ id: billId, profile_id: profileId, bill_number: 1, total_loan_amount: 100, customer_id: customerId }));
    insert.run(itemId, "bill_items", JSON.stringify({ id: itemId, bill_id: billId, loan_amount: 100 }));
    db.prepare("INSERT INTO customers VALUES(?,?,?,?,?)").run(customerId, profileId, 1, customerId, "PRIVATE NAME");
    db.close();
    const before = readFileSync(filename);
    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts", "check-local-migration.mjs")], { env: { ...process.env, LOCAL_DATA_DIR: directory }, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, stores: [{ ok: true, loanPaise: 10000 }] });
    expect(result.stdout).not.toContain("PRIVATE NAME");
    expect(readFileSync(filename)).toEqual(before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
