import { containsTamil, englishRecordMessage } from "./english-records";
import ExcelJS from "exceljs";
import { maxSequenceDeliveryNumber, sequenceDeliveryNumber } from "./delivery-status";

const aliases: Record<string, string> = {
  deliveryno: "deliveryNo", deliverynumber: "deliveryNo", deliverybillno: "deliveryNo",
  deliverydate: "deliveryDate", deliverybilldate: "deliveryDate",
  date: "billDate", billdate: "billDate", billno: "billNo", billnumber: "billNo",
  address: "address", name: "name", customername: "name", particulars: "particulars",
  phone: "phone", phonenumber: "phone", mobile: "phone", mobilenumber: "phone", amount: "amount",
};
const required = ["billDate", "billNo", "address", "name", "particulars", "amount"];
const voidMarker = /^void\s*[—–-]\s*/i;

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if ("result" in value) {
      const result = value.result;
      return result && typeof result === "object" && !(result instanceof Date) ? "" : result;
    }
    if ("richText" in value) return value.richText.map(part => part.text).join("");
    if ("text" in value) return value.text;
    return "";
  }
  return value;
}
function cellHasError(value: ExcelJS.CellValue) {
  if (!value || typeof value !== "object" || value instanceof Date) return false;
  if ("error" in value) return true;
  if (!("result" in value)) return false;
  const result = value.result;
  return Boolean(result && typeof result === "object" && "error" in result);
}
function stringValue(value: ExcelJS.CellValue) { return String(cellValue(value) ?? "").trim(); }
function dateValue(value: ExcelJS.CellValue, date1904: boolean): string | null {
  const raw = cellValue(value);
  if (raw == null || raw === "") return null;
  let date: Date;
  if (raw instanceof Date) date = raw;
  else if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 1 || raw > 2958465) return null;
    date = new Date(Date.UTC(1899, 11, 30) + (raw + (date1904 ? 1462 : 0)) * 86400000);
  } else {
    const text = String(raw).trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      date = new Date(`${text}T00:00:00Z`);
      return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
    }
    const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
    if (!match) return null;
    // A two-digit year later than this year belongs to the previous century.
    const shortYear = Number(match[3]);
    const year = match[3].length === 4 ? shortYear : shortYear <= new Date().getFullYear() % 100 ? 2000 + shortYear : 1900 + shortYear;
    date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[1])) return null;
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
const numberKey = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? String(Number(value)) : value;

export type HistoricalImportRow = {
  sheet: string; row: number; billNo: string; billDate: string | null; deliveryNo: string; deliveryDate: string | null;
  name: string; address: string; particulars: string; phone: string; amount: number | null; voided: boolean;
  /** Must be fixed in the workbook before importing. */
  issues: string[];
  /** Shown for review; these do not stop the import. */
  notices: string[];
};

/** Read only: no records are saved and unknown information is never invented. */
export async function previewHistoricalWorkbook(bytes: Buffer, today = localToday()) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  const rows: HistoricalImportRow[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  for (const sheet of workbook.worksheets) {
    let headerRow = 0;
    let columns: Record<string, number> = {};
    sheet.eachRow((row, number) => {
      if (headerRow || number > 30) return;
      const candidate: Record<string, number> = {};
      row.eachCell((cell, col) => { const key = aliases[stringValue(cell.value).toLowerCase().replace(/[^a-z0-9]/g, "")]; if (key && !candidate[key]) candidate[key] = col; });
      if (required.every(key => candidate[key])) { headerRow = number; columns = candidate; }
    });
    if (!headerRow) {
      if (sheet.actualRowCount > 0) notes.push(`Sheet "${sheet.name}" has no recognised bill header, so it will be skipped. If it holds bills, fix its headings and preview again.`);
      continue;
    }
    const value = (row: ExcelJS.Row, key: string) => columns[key] ? row.getCell(columns[key]).value : null;
    sheet.eachRow((row, number) => {
      if (number <= headerRow) return;
      const billNo = stringValue(value(row, "billNo"));
      const name = stringValue(value(row, "name"));
      const rawParticulars = stringValue(value(row, "particulars"));
      if (!billNo && !name && !rawParticulars && !stringValue(value(row, "amount"))) return;
      const voided = voidMarker.test(rawParticulars);
      const particulars = rawParticulars.replace(voidMarker, "").trim();
      const billDateRaw = value(row, "billDate"), deliveryDateRaw = value(row, "deliveryDate");
      const billDate = dateValue(billDateRaw, Boolean(workbook.properties.date1904));
      const deliveryDate = dateValue(deliveryDateRaw, Boolean(workbook.properties.date1904));
      const amountRaw = cellValue(value(row, "amount"));
      const amountText = String(amountRaw ?? "").replace(/[₹,\s]/g, "");
      const amount = amountText && /^\d+(?:\.\d{1,2})?$/.test(amountText) ? Number(amountText) : null;
      const address = stringValue(value(row, "address"));
      const phone = stringValue(value(row, "phone"));
      const deliveryNo = stringValue(value(row, "deliveryNo"));
      const issues: string[] = [];
      const notices: string[] = [];
      if (Object.values(columns).some(column => cellHasError(row.getCell(column).value))) issues.push("A cell has a formula error");
      if (!/^\d+$/.test(billNo) || Number(billNo) < 1 || !Number.isSafeInteger(Number(billNo))) issues.push("Check bill number");
      else if (Number(billNo) > 2147483646) issues.push("Bill number is too large");
      if (!billDate) issues.push("Check bill date");
      else if (billDate > today) issues.push("Bill date is in the future");
      else if (billDate < "2000-01-01") notices.push("Bill date is before 2000; check the year");
      if (cellValue(deliveryDateRaw) != null && stringValue(deliveryDateRaw) !== "" && !deliveryDate) issues.push("Check delivery date");
      if (deliveryDate && deliveryDate > today) issues.push("Delivery date is in the future");
      if (billDate && deliveryDate && deliveryDate < billDate) issues.push("Delivery date is before bill date");
      for (const [column, value] of Object.entries({ Phone: phone, "Delivery number": deliveryNo })) {
        if (containsTamil(value)) issues.push(`${column}: ${englishRecordMessage}`);
      }
      if (!name || !particulars) issues.push("Missing customer or particulars");
      if (name.length > 120) issues.push("Customer name is too long (120 characters maximum)");
      if (particulars.length > 180) issues.push("Particulars are too long (180 characters maximum)");
      if (address.length > 500) issues.push("Address is too long (500 characters maximum)");
      if (phone.length > 20) issues.push("Phone is too long (20 characters maximum)");
      if (deliveryNo.length > 60) issues.push("Delivery number is too long (60 characters maximum)");
      if (amount === null || amount <= 0) issues.push("Check loan amount");
      else if (amount > 100_000_000) issues.push("Loan amount is above the ₹10 crore limit");
      if (deliveryDate && !deliveryNo) notices.push("Delivery date recorded; delivery number missing");
      if (deliveryNo && !deliveryDate) notices.push("Delivery number recorded; delivery date missing");
      if (deliveryNo && sequenceDeliveryNumber(deliveryNo) === null) notices.push(`Delivery number will be kept as written but won't affect numbering (not a number up to ${maxSequenceDeliveryNumber.toLocaleString("en-IN")})`);
      if (voided) notices.push("Marked VOID in the register; will be imported as a voided bill");
      rows.push({ sheet: sheet.name, row: number, billNo, billDate, deliveryNo, deliveryDate, name, address, particulars, phone, amount, voided, issues, notices });
    });
  }
  if (!rows.length) warnings.push("No bill rows found. Check the file and column headings.");
  const count = (values: string[]) => values.reduce((counts, key) => key ? counts.set(key, (counts.get(key) ?? 0) + 1) : counts, new Map<string, number>());
  const billCounts = count(rows.map(row => numberKey(row.billNo)));
  const deliveryCounts = count(rows.map(row => numberKey(row.deliveryNo)));
  rows.forEach(row => {
    if ((billCounts.get(numberKey(row.billNo)) ?? 0) > 1) row.issues.push("Duplicate bill number in file");
    if ((deliveryCounts.get(numberKey(row.deliveryNo)) ?? 0) > 1) row.notices.push("Delivery number also appears on another row");
  });
  return { rows, warnings, notes };
}
