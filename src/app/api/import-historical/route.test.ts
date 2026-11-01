import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { DatabaseSync } from "node:sqlite";
import { createLocalDatabase, localOwnerId } from "../../../lib/local-database";
import { POST } from "./route";

const originalDirectory = process.env.LOCAL_DATA_DIR;
const originalMultiUser = process.env.BILLING_MULTI_USER;
const opened: { directory: string; db: ReturnType<typeof createLocalDatabase> }[] = [];
afterEach(() => {
  for (const { directory, db } of opened.splice(0)) { db.close(); rmSync(directory, { recursive: true, force: true }); }
  if (originalDirectory === undefined) delete process.env.LOCAL_DATA_DIR; else process.env.LOCAL_DATA_DIR = originalDirectory;
  if (originalMultiUser === undefined) delete process.env.BILLING_MULTI_USER; else process.env.BILLING_MULTI_USER = originalMultiUser;
});

describe("historical import", () => {
  it("backs up the database, imports the workbook, rebuilds Excel, and rejects reimport", async () => {
    const directory = mkdtempSync(join(tmpdir(), "billing-import-"));
    process.env.LOCAL_DATA_DIR = directory; process.env.BILLING_MULTI_USER = "0";
    const db = createLocalDatabase(directory); opened.push({ directory, db });
    const profile = await db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { businessName: "Finance", address: "123 Main Street", phone: "1234567890", accountSlot: 1, nextBillNumber: 1 } });
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Bills");
    sheet.addRow(["Delivery No", "Delivery Date", "DATE", "BILL NO", "Address", "NAME", "Particulars", "PHONE", "AMOUNT"]);
    sheet.addRow(["", "31/5/22", "1/4/22", 7003, "Vishnu Nagar", "M.Yuvaragj", "Minor Chain", "", 20500]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const request = () => { const form = new FormData(); form.append("file", new File([bytes], "old.xlsx")); form.append("metals", JSON.stringify({ "Bills:2": "Gold" })); return new Request("http://127.0.0.1:3101/api/import-historical?account=1", { method: "POST", body: form }); };
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(201); expect(body).toMatchObject({ count: 1, warning: "" });
    const backups = readdirSync(join(directory, "backups"));
    expect(backups).toHaveLength(1);
    const backup = new DatabaseSync(join(directory, "backups", backups[0]), { readOnly: true });
    expect(backup.prepare("SELECT count(*) AS count FROM records WHERE table_name='bills'").get()?.count).toBe(0);
    backup.close();
    expect(readdirSync(join(directory, "registers"))).toContain(`${profile.data.id}.xlsx`);
    const rows = await db.from("bills").select("*, bill_items(*)").eq("profile_id", profile.data.id);
    expect(rows.data[0]).toMatchObject({ bill_number: 7003, delivery_no: null, delivery_date: "2022-05-31", historical_delivery: true, historical_import: true, excel_sync_status: "synced", total_loan_amount: 20500 });
    const again = await POST(request());
    expect(again.status).toBe(400);
    expect((await again.json()).error).toContain("duplicated");
    expect((await db.from("bills").select().eq("profile_id", profile.data.id)).data).toHaveLength(1);
  });
});
