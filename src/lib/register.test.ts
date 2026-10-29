import ExcelJS from "exceljs";
import { expect, it } from "vitest";
import { appendRegisterBill, billRegisterRow, createRegister } from "./register";
import { itemSummary } from "./money";
import { registerHeaders, type Bill } from "./types";

const bill = (overrides: Partial<Bill> = {}): Bill => ({
  id: "bill-1", billNumber: 1, billDate: "2026-10-29", customerName: "Customer", fatherName: "Parent",
  address: "Address", phone: "0123456789", items: [{ particulars: "Gold ring", grams: 2, assessedValue: 100, loanAmount: 80 }],
  totalAssessedValue: 100, totalLoanAmount: 80, amountInWords: "Eighty", status: "issued", excelSyncStatus: "synced", createdAt: "2026-10-29",
  ...overrides,
});

async function roundtrip(workbook: ExcelJS.Workbook) {
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer() as never);
  return loaded.getWorksheet("Bills")!;
}

it.each([
  ["ASCII words", "Long street address near the market ".repeat(14).slice(0, 500)],
  ["Tamil", "தமிழ்நாடு சென்னை அண்ணா நகர் ".repeat(18).slice(0, 500)],
  ["unbroken words", "W".repeat(500)],
])("wraps and sizes long %s values without changing them", async (_label, address) => {
  const workbook = createRegister();
  appendRegisterBill(workbook, bill({ address, customerName: address.slice(0, 120) }));
  const sheet = await roundtrip(workbook);
  expect(sheet.getRow(2).height).toBeGreaterThan(150);
  expect(sheet.getRow(2).height).toBeLessThanOrEqual(409.5);
  for (const column of ["E", "F", "G"]) {
    expect(sheet.getCell(`${column}2`).alignment).toMatchObject({ wrapText: true, vertical: "top" });
  }
  expect(sheet.getCell("E2").value).toBe(address);
  expect(sheet.getCell("F2").value).toBe(address.slice(0, 120));
});

it("counts explicit newlines and preserves short-row and header readability", async () => {
  const workbook = createRegister();
  appendRegisterBill(workbook, bill({ address: "One\r\nTwo\n\nFour" }));
  appendRegisterBill(workbook, bill({ billNumber: 2 }));
  const sheet = await roundtrip(workbook);
  expect(sheet.getRow(2).height).toBeGreaterThanOrEqual(66);
  expect(sheet.getRow(3).height).toBe(22);
  expect(sheet.getRow(1).height).toBeGreaterThanOrEqual(22);
  expect(sheet.getRow(1).font).toMatchObject({ bold: true, size: 11 });
  expect(sheet.getRow(1).values).toEqual([undefined, ...registerHeaders]);
  expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  // XML normalizes CRLF line endings, while preserving all four lines.
  expect(sheet.getCell("E2").value).toBe("One\nTwo\n\nFour");
});

it.each(["address", "customerName", "particulars"])("sizes a row when only %s is long", async (field) => {
  const value = "A lengthy description with words ".repeat(6);
  const workbook = createRegister();
  appendRegisterBill(workbook, bill(field === "particulars"
    ? { items: [{ particulars: value, grams: 2, assessedValue: 100, loanAmount: 80 }] }
    : { [field]: value }));
  const sheet = await roundtrip(workbook);
  expect(sheet.getRow(2).height).toBeGreaterThan(22);
});

it("repairs old rows and a stale table on append, preserving complete extreme particulars and cell types", async () => {
  const workbook = createRegister(); const sheet = workbook.getWorksheet("Bills")!;
  const oldBill = bill({ phone: "", deliveryNo: " ", items: Array.from({ length: 30 }, () => ({ particulars: "W".repeat(180), grams: 2, assessedValue: 100, loanAmount: 80 })) });
  // Old files can contain worksheet rows beyond the table's saved range.
  sheet.addRow(billRegisterRow(oldBill));
  sheet.getRow(2).height = 15;
  sheet.getCell("G2").alignment = { wrapText: false };
  appendRegisterBill(workbook, bill({ billNumber: 2 }));
  appendRegisterBill(workbook, bill({ billNumber: 1, status: "void" }));
  const loaded = await roundtrip(workbook);
  expect(loaded.getTable("Bills")).toMatchObject({ table: { tableRef: "A1:I3" } });
  expect(loaded.getRow(2).height).toBe(409.5);
  expect(loaded.getCell("G2").alignment.wrapText).toBe(true);
  expect(loaded.getCell("G2").value).toBe(`VOID — ${itemSummary(oldBill.items)}`);
  for (const column of ["A", "B", "H"]) expect(loaded.getCell(`${column}2`).value).toBeNull();
  expect(loaded.getCell("H3").value).toBe("0123456789");
  expect(loaded.getCell("H3").numFmt).toBe("@");
  expect(loaded.getCell("I2").value).toBe(80);
  expect(loaded.getCell("I2").numFmt).toBe('"₹" #,##0.00');
});
