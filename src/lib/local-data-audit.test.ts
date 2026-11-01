import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

it("counts local records without displaying private data or modifying the database", () => {
  const directory = mkdtempSync(join(tmpdir(), "finance-audit-")); directories.push(directory);
  const path = join(directory, "billing.sqlite"); const db = new DatabaseSync(path);
  db.exec("CREATE TABLE records (table_name TEXT, body TEXT); CREATE TABLE customers (name TEXT); INSERT INTO records VALUES ('bills', '{\"name\":\"PRIVATE NAME\"}'), ('business_profiles', '{}'), ('bill_items', '{}'); INSERT INTO customers VALUES ('PRIVATE NAME');");
  db.close();
  const before = readFileSync(path);
  const output = execFileSync(process.execPath, [join(process.cwd(), "scripts", "audit-local-data.mjs")], { env: { ...process.env, LOCAL_DATA_DIR: directory }, encoding: "utf8" });
  expect(JSON.parse(output)).toMatchObject({ dataStores: 1, businessProfiles: 1, bills: 1, billItems: 1, customers: 1, warnings: [] });
  expect(output).not.toContain("PRIVATE NAME");
  expect(readFileSync(path)).toEqual(before);
});
