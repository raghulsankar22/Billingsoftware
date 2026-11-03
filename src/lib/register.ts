import ExcelJS from "exceljs";
import { excelINRFormat, itemSummary } from "./money";
import { billReceiptLabels, collectedByText, registerHeaders, type Bill } from "./types";

const optionalCell = (value?: string | null) => value?.trim() || null;
const registerWidths = [16, 16, 14, 12, 34, 26, 55, 18, 18];
const wrappedColumns = [5, 6, 7];

function characterWidth(character: string) {
  if (character === "\t") return 2.4;
  if (character === " ") return 0.6;
  if (/[ilI.,'`:;!|]/.test(character)) return 0.6;
  if (/[MW@%#&]/.test(character)) return 1.65;
  if (/[A-Z]/.test(character)) return 1.35;
  if (/\p{Mark}/u.test(character)) return 0.5;
  return character.codePointAt(0)! > 127 ? 2.3 : 1.1;
}

function wrappedLineCount(text: string, columnWidth: number) {
  // ExcelJS does not measure rendered text. Reserve horizontal padding and use
  // conservative Calibri 11 character widths, including Tamil/fallback glyphs.
  const availableWidth = Math.max(1, (columnWidth - 2) * 0.9);
  let lines = 0;
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    lines++;
    let usedWidth = 0;
    for (const token of paragraph.split(/([ \t]+)/)) {
      const characters = Array.from(token);
      const tokenWidth = characters.reduce((width, character) => width + characterWidth(character), 0);
      // Move whole words to the next line where possible, as Excel does.
      if (usedWidth > 0 && usedWidth + tokenWidth > availableWidth) {
        lines++; usedWidth = 0;
      }
      // Long unbroken words still wrap; count them one character at a time.
      for (const character of characters) {
        const width = characterWidth(character);
        if (usedWidth > 0 && usedWidth + width > availableWidth) { lines++; usedWidth = 0; }
        usedWidth += width;
      }
    }
  }
  return lines;
}

/** Apply after table.commit/addTable so exports and repaired registers agree. */
export function formatRegisterSheet(sheet: ExcelJS.Worksheet) {
  registerWidths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getColumn(9).numFmt = excelINRFormat;
  for (const column of [1, 2, 8]) sheet.getColumn(column).numFmt = "@";
  for (const column of wrappedColumns) sheet.getColumn(column).alignment = { vertical: "top", wrapText: true };
  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  header.alignment = { vertical: "middle", wrapText: true };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.font = { ...row.font, name: "Calibri", size: 11 };
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { ...cell.font, name: "Calibri", size: 11 };
      cell.alignment = { ...cell.alignment, vertical: "top", ...(wrappedColumns.includes(column) ? { wrapText: true } : {}) };
    });
    const lines = Math.max(1, ...wrappedColumns.map((column) => wrappedLineCount(row.getCell(column).text, sheet.getColumn(column).width!)));
    // Excel caps row height at 409.5 points. Keep the full value even when a
    // maximum-size particulars list exceeds what Excel can display in one row.
    row.height = Math.min(409.5, Math.max(22, lines * 16 + 6));
  });
}

export function billRegisterRow(bill: Bill) {
  const delivered = Boolean(bill.deliveryNo && bill.deliveryDate);
  const deliveryRemark = (delivered && bill.deliveryBillReceiptStatus ? ` [Delivery: ${billReceiptLabels[bill.deliveryBillReceiptStatus]}]` : "") + (delivered && bill.lostBillDeclaredAt ? " [Declaration signed]" : "") + (delivered && collectedByText(bill) ? ` [Taken by: ${collectedByText(bill)}]` : "");
  return [optionalCell(bill.deliveryNo), optionalCell(bill.deliveryDate), bill.billDate, bill.billNumber, bill.address, bill.customerName, `${bill.status === "void" ? "VOID — " : ""}${itemSummary(bill.items)}${deliveryRemark}`, optionalCell(bill.phone), bill.totalLoanAmount];
}

export function createRegister() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bills");
  sheet.addTable({ name: "Bills", ref: "A1", headerRow: true, totalsRow: false, columns: registerHeaders.map((name) => ({ name })), rows: [] });
  formatRegisterSheet(sheet);
  return workbook;
}

export function requireRegisterSheet(workbook: ExcelJS.Workbook) {
  const sheet = workbook.getWorksheet("Bills");
  if (!sheet) throw new Error("The workbook has no Bills register. Choose a billing register workbook.");
  if (sheet.actualColumnCount !== registerHeaders.length || registerHeaders.some((header, index) => sheet.getCell(1, index + 1).value !== header)) {
    throw new Error("The workbook's Bills headers do not match this app's register.");
  }
  return sheet;
}

export function appendRegisterBill(workbook: ExcelJS.Workbook, bill: Bill) {
  const sheet = requireRegisterSheet(workbook);
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
  formatRegisterSheet(sheet);
}
