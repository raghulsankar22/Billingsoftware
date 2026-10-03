import ExcelJS from "exceljs";
import { itemSummary } from "./money";
import { registerHeaders, type Bill } from "./types";

export function billRegisterRow(bill: Bill) {
  return [bill.deliveryNo ?? "", bill.deliveryDate ?? "", bill.billDate, bill.billNumber, bill.address, bill.customerName, `${bill.status === "void" ? "VOID — " : ""}${itemSummary(bill.items)}`, bill.phone, bill.totalLoanAmount];
}

export function createRegister() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bills");
  sheet.columns = [16, 16, 14, 12, 34, 26, 55, 18, 18].map((width) => ({ width }));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.addTable({ name: "Bills", ref: "A1", headerRow: true, totalsRow: false, columns: registerHeaders.map((name) => ({ name })), rows: [] });
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  sheet.getColumn(9).numFmt = '₹#,##0.00';
  return workbook;
}

export function appendRegisterBill(workbook: ExcelJS.Workbook, bill: Bill) {
  const sheet = workbook.getWorksheet("Bills");
  if (!sheet) throw new Error("The workbook has no Bills register. Choose a billing register workbook.");
  if (registerHeaders.some((header, index) => sheet.getCell(1, index + 1).value !== header)) {
    throw new Error("The workbook's Bills headers do not match this app's register.");
  }
  const rows: ExcelJS.CellValue[][] = [];
  let existing = false;
  for (let index = 2; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index);
    if (row.hasValues) {
      rows.push(Array.from({ length: 9 }, (_, column) => row.getCell(column + 1).value));
      if (Number(row.getCell(4).value) === bill.billNumber) {
        existing = true;
        if (bill.status === "void" && !String(rows[rows.length - 1][6] ?? "").startsWith("VOID — ")) rows[rows.length - 1][6] = `VOID — ${rows[rows.length - 1][6] ?? ""}`;
      }
    }
  }
  if (!existing) rows.push(billRegisterRow(bill));
  // Rebuild from worksheet rows to repair registers created with stale tables.
  if (sheet.getTable("Bills")) sheet.removeTable("Bills");
  sheet.addTable({ name: "Bills", ref: "A1", headerRow: true, totalsRow: false, columns: registerHeaders.map((name) => ({ name })), rows });
  sheet.getColumn(9).numFmt = '₹#,##0.00';
}
