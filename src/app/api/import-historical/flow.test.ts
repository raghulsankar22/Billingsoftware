import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDatabase, localOwnerId } from "../../../lib/local-database";
import { POST as importBills } from "./route";
import { POST as previewBills } from "../import-preview/route";

const directory = mkdtempSync(join(tmpdir(), "billing-import-route-"));
const original = { dir: process.env.LOCAL_DATA_DIR, users: process.env.BILLING_MULTI_USER };
const backups = () => { const path = join(directory, "backups"); return existsSync(path) ? readdirSync(path).length : 0; };

async function workbook(rows: unknown[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Bills");
  sheet.addRow(["Delivery No", "Delivery Date", "Date", "Bill No", "Address", "Name", "Particulars", "Phone", "Amount"]);
  rows.forEach(row => sheet.addRow(row));
  book.addWorksheet("Empty");
  return new File([await book.xlsx.writeBuffer()], "register.xlsx");
}
function request(path: string, file: File, metals?: Record<string, string>) {
  const form = new FormData();
  form.append("file", file);
  if (metals) form.append("metals", JSON.stringify(metals));
  return new Request(`http://127.0.0.1:3100${path}?account=1`, { method: "POST", body: form });
}

describe("importing a register workbook", () => {
  beforeAll(async () => {
    process.env.LOCAL_DATA_DIR = directory;
    process.env.BILLING_MULTI_USER = "0";
    const saved = await createLocalDatabase().rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { businessName: "Finance", address: "123 Main Street", phone: "1234567890", accountSlot: 1 } });
    expect(saved.error).toBeNull();
  });
  afterAll(() => {
    createLocalDatabase().close();
    if (original.dir === undefined) delete process.env.LOCAL_DATA_DIR; else process.env.LOCAL_DATA_DIR = original.dir;
    if (original.users === undefined) delete process.env.BILLING_MULTI_USER; else process.env.BILLING_MULTI_USER = original.users;
    rmSync(directory, { recursive: true, force: true });
  });

  it("refuses a flagged workbook readably and leaves no backup behind", async () => {
    const file = await workbook([["", "", "1/4/22", 1, "Street", "Customer", "Ring", "9876543210, 9876543211", 1000]]);
    const response = await importBills(request("/api/import-historical", file, { "Bills:2": "Gold" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Phone is too long");
    expect(backups()).toBe(0);
  });
  it("previews then imports voided and active rows, skipping the empty sheet", async () => {
    const file = await workbook([
      ["", "", "1/4/22", 1, "Street", "Voided Customer", "VOID — Gold: Ring (2 g)", "", 1000],
      ["9876543210", "1/5/22", "1/4/22", 2, "Street", "Delivered Customer", "Chain", "", 2000],
      ["", "", "1/4/22", 3, "Street", "Waiting Customer", "Ring", "", 3000],
    ]);
    const preview = await (await previewBills(request("/api/import-preview", file))).json();
    expect(preview.warnings).toEqual([]);
    expect(preview.rows.flatMap((row: { issues: string[] }) => row.issues)).toEqual([]);

    const response = await importBills(request("/api/import-historical", file, { "Bills:2": "Gold", "Bills:3": "Gold", "Bills:4": "Silver" }));
    expect(response.status).toBe(201);
    expect((await response.json()).count).toBe(3);
    expect(backups()).toBe(1);

    const db = createLocalDatabase();
    const { data: bills } = await db.from("bills").select("*, bill_items(*)").order("bill_number");
    expect(bills.map((bill: { status: string }) => bill.status)).toEqual(["void", "issued", "issued"]);
    expect(bills[0].bill_items[0].particulars).toBe("Gold: Ring (2 g)");
    const number = await db.rpc("get_next_delivery_number", { p_owner_id: localOwnerId, p_account_slot: 1 });
    expect(number.data.number).toBe(1);

    const again = await (await previewBills(request("/api/import-preview", file))).json();
    expect(again.rows[0].issues).toContain("Bill number already exists in this account");
  });
});
