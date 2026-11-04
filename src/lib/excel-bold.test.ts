import ExcelJS from "exceljs";
import { expect, it } from "vitest";
import { buildAllAccountRegister } from "./all-account-register";
import { buildReportRegister } from "./excel-report";
import { buildNoticeRegister } from "./notice-report";
import { appendRegisterBill, createRegister } from "./register";
import type { Bill } from "./types";

const bill = (overrides: Partial<Bill> = {}): Bill => ({
  id: "bill-1", billNumber: 1, billDate: "2025-10-12", customerName: "Customer", fatherName: "Parent",
  address: "12 Main Road\nChennai", phone: "0123456789", items: [{ metal: "Gold", particulars: "Gold ring", grams: 2, assessedValue: 100, loanAmount: 80 }],
  totalAssessedValue: 100, totalLoanAmount: 80, amountInWords: "Eighty", status: "issued", excelSyncStatus: "synced", createdAt: "2025-10-12",
  ...overrides,
});

/** Saves and reopens the workbook, as Excel will, then returns every cell that is not bold. */
async function notBold(workbook: ExcelJS.Workbook) {
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer() as never);
  const problems: string[] = [];
  let cells = 0;
  loaded.eachSheet(sheet => {
    sheet.eachRow(row => {
      for (let column = 1; column <= sheet.columnCount; column++) {
        cells++;
        const cell = row.getCell(column);
        if (cell.font?.bold !== true) problems.push(`${sheet.name}!${cell.address}`);
      }
    });
  });
  expect(cells).toBeGreaterThan(0);
  return problems;
}

const bills = [
  bill(),
  bill({ id: "bill-2", billNumber: 2, status: "void", customerName: "Voided Customer" }),
  bill({ id: "bill-3", billNumber: 3, deliveryNo: "7", deliveryDate: "2025-11-01", phone: "" }),
];

it("saves every cell of the bill register in bold, including appended and voided bills", async () => {
  const workbook = createRegister();
  for (const item of bills) appendRegisterBill(workbook, item);
  expect(await notBold(workbook)).toEqual([]);
});

it("keeps the red strike-through on voided rows while making them bold", async () => {
  const workbook = buildReportRegister(bills);
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer() as never);
  const cell = loaded.getWorksheet("Bills")!.getCell("F3");
  expect(cell.value).toBe("Voided Customer");
  expect(cell.font).toMatchObject({ bold: true, strike: true });
});

it("saves the downloadable Excel report and the combined all-account workbook in bold", async () => {
  expect(await notBold(buildReportRegister(bills))).toEqual([]);
  expect(await notBold(buildAllAccountRegister([{ profileId: "one", accountSlot: 1, bills }, { profileId: "two", accountSlot: 2, bills: [bills[0]] }]))).toEqual([]);
});

it("saves every cell of the notice Excel in bold, including the long message columns", async () => {
  const workbook = buildNoticeRegister(bills, 1, { business_name: "Finance" }, "2026-11-20");
  expect(await notBold(workbook)).toEqual([]);
});
