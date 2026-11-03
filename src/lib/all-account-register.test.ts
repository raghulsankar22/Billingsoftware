import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAllAccountRegister, loadAccountReports } from "./all-account-register";
import { createLocalDatabase, localOwnerId } from "./local-database";
import { syncAllAccountRegisters } from "./register-sync";
import { registerHeaders } from "./types";

let directory: string;
let database: ReturnType<typeof createLocalDatabase>;
const input = { billDate: "2024-01-01", customerName: "Sample Customer", fatherName: "Parent", address: "Sample Address", phone: "", items: [{ metal: "Gold", particulars: "Ring 2", grams: 2, assessedValue: 200, loanAmount: 100 }] };

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "billing-all-accounts-"));
  vi.stubEnv("LOCAL_DATA_DIR", directory);
  vi.stubEnv("BILLING_MULTI_USER", "0");
  database = createLocalDatabase(directory);
  for (const accountSlot of [1, 2, 4]) {
    const result = await database.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { businessName: "Sample Finance", address: "Sample Street", phone: "1234567890", accountSlot } });
    expect(result.error).toBeNull();
  }
  for (const accountSlot of [1, 4]) {
    const result = await database.rpc("create_bill", { p_owner_id: localOwnerId, p_bill: { ...input, accountSlot, customerName: accountSlot === 1 ? "=1+1" : "குமார்" } });
    expect(result.error).toBeNull();
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  database.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("all-account Excel", () => {
  it("exports full histories with independent numbered sheets, including empty configured accounts", async () => {
    const reports = await loadAccountReports(localOwnerId);
    expect(reports.map(report => report.accountSlot)).toEqual([1, 2, 4]);
    expect(reports.map(report => report.bills.length)).toEqual([1, 0, 1]);
    const workbook = buildAllAccountRegister(reports.reverse());
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await workbook.xlsx.writeBuffer() as never);
    expect(loaded.worksheets.map(sheet => sheet.name)).toEqual(["Account 1", "Account 2", "Account 4"]);
    for (const sheet of loaded.worksheets) {
      expect(registerHeaders.map((_, index) => sheet.getCell(1, index + 1).value)).toEqual(registerHeaders);
      expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
      expect(sheet.getCell("I2").numFmt).toContain("₹");
    }
    expect(loaded.getWorksheet("Account 1")!.getCell("F2").value).toBe("=1+1");
    expect(loaded.getWorksheet("Account 1")!.getCell("C2").value).toBe("2024-01-01");
    expect(loaded.getWorksheet("Account 2")!.getCell("D2").value).toBeNull();
    expect(loaded.getWorksheet("Account 4")!.getCell("F2").value).toBe("குமார்");
    expect(loaded.getWorksheet("Account 4")!.getCell("G2").value).toContain("Ring 2");
    expect(loaded.getWorksheet("Account 1")!.getTable("Account_1_Bills")).toBeDefined();
    expect(loaded.getWorksheet("Account 4")!.getTable("Account_4_Bills")).toBeDefined();
  });
  it("does not expose another owner's profiles or create sheets for unset accounts", async () => {
    await expect(loadAccountReports("another-owner")).rejects.toThrow("Set up a business account");
    const reports = await loadAccountReports(localOwnerId);
    expect(reports.some(report => report.accountSlot === 3)).toBe(false);
    expect(() => buildAllAccountRegister([])).toThrow("Set up a business account");
  });
  it("refreshes every sheet and saved account register without altering bills or sequences", async () => {
    const before = await database.from("bills").select().order("bill_number");
    const target = await syncAllAccountRegisters(localOwnerId);
    expect(target).toBe(join(directory, "registers", "All Accounts.xlsx"));
    const added = await database.rpc("create_bill", { p_owner_id: localOwnerId, p_bill: { ...input, accountSlot: 4, customerName: "Next Customer" } });
    expect(added.error).toBeNull();
    expect((await loadAccountReports(localOwnerId)).find(report => report.accountSlot === 4)!.bills.map(bill => bill.billNumber)).toEqual([1, 2]);
    await syncAllAccountRegisters(localOwnerId);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.readFile(target);
    expect(loaded.getWorksheet("Account 4")!.getCell("F3").value).toBe("Next Customer");
    for (const report of await loadAccountReports(localOwnerId)) {
      const saved = new ExcelJS.Workbook();
      await saved.xlsx.readFile(join(directory, "registers", report.profileId + ".xlsx"));
      expect(saved.getWorksheet("Bills")!.getCell("D2").value).toBe(report.bills.length ? 1 : null);
    }
    const after = await database.from("bills").select().order("bill_number");
    for (const row of before.data) expect(after.data.find((entry: { id: string }) => entry.id === row.id)).toEqual(row);
  });
  it("keeps the previous workbook intact on a locked file and supports a later retry", async () => {
    const target = await syncAllAccountRegisters(localOwnerId);
    const before = await fs.readFile(target);
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (String(destination) === target) throw new Error("Workbook is open in Excel");
      return rename(source, destination);
    });
    await expect(syncAllAccountRegisters(localOwnerId)).rejects.toThrow("Workbook is open");
    expect(await fs.readFile(target)).toEqual(before);
    expect((await fs.readdir(join(directory, "registers"))).some(name => name.endsWith(".tmp"))).toBe(false);
    vi.restoreAllMocks();
    await expect(syncAllAccountRegisters(localOwnerId)).resolves.toBe(target);
  });
});
