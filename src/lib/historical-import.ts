import ExcelJS from "exceljs";

const aliases: Record<string, string> = {
  deliveryno: "deliveryNo", deliverynumber: "deliveryNo", deliverybillno: "deliveryNo",
  deliverydate: "deliveryDate", deliverybilldate: "deliveryDate",
  date: "billDate", billdate: "billDate", billno: "billNo", billnumber: "billNo",
  address: "address", name: "name", customername: "name", particulars: "particulars",
  phone: "phone", phonenumber: "phone", mobile: "phone", mobilenumber: "phone", amount: "amount",
};
const required = ["billDate", "billNo", "address", "name", "particulars", "amount"];

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if ("result" in value) return value.result;
    if ("richText" in value) return value.richText.map(part => part.text).join("");
    if ("text" in value) return value.text;
    return "";
  }
  return value;
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
    const year = Number(match[3]) + (match[3].length === 2 ? 2000 : 0);
    date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[1])) return null;
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export type HistoricalImportRow = { sheet: string; row: number; billNo: string; billDate: string | null; deliveryNo: string; deliveryDate: string | null; name: string; address: string; particulars: string; phone: string; amount: number | null; issues: string[] };

/** Read only: no records are saved and unknown information is never invented. */
export async function previewHistoricalWorkbook(bytes: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  const rows: HistoricalImportRow[] = [];
  const warnings: string[] = [];
  for (const sheet of workbook.worksheets) {
    let headerRow = 0;
    let columns: Record<string, number> = {};
    sheet.eachRow((row, number) => {
      if (headerRow || number > 30) return;
      const candidate: Record<string, number> = {};
      row.eachCell((cell, col) => { const key = aliases[stringValue(cell.value).toLowerCase().replace(/[^a-z0-9]/g, "")]; if (key && !candidate[key]) candidate[key] = col; });
      if (required.every(key => candidate[key])) { headerRow = number; columns = candidate; }
    });
    if (!headerRow) { warnings.push(`Sheet "${sheet.name}" has no recognised bill header and was not read.`); continue; }
    const value = (row: ExcelJS.Row, key: string) => columns[key] ? row.getCell(columns[key]).value : null;
    sheet.eachRow((row, number) => {
      if (number <= headerRow) return;
      const billNo = stringValue(value(row, "billNo"));
      const name = stringValue(value(row, "name"));
      const particulars = stringValue(value(row, "particulars"));
      if (!billNo && !name && !particulars && !stringValue(value(row, "amount"))) return;
      const billDateRaw = value(row, "billDate"), deliveryDateRaw = value(row, "deliveryDate");
      const billDate = dateValue(billDateRaw, Boolean(workbook.properties.date1904));
      const deliveryDate = dateValue(deliveryDateRaw, Boolean(workbook.properties.date1904));
      const amountRaw = cellValue(value(row, "amount"));
      const amountText = String(amountRaw ?? "").replace(/[₹,\s]/g, "");
      const amount = amountText && /^\d+(?:\.\d{1,2})?$/.test(amountText) ? Number(amountText) : null;
      const issues: string[] = [];
      if (!/^\d+$/.test(billNo) || Number(billNo) < 1 || !Number.isSafeInteger(Number(billNo))) issues.push("Check bill number");
      if (!billDate) issues.push("Check bill date");
      if (cellValue(deliveryDateRaw) != null && stringValue(deliveryDateRaw) !== "" && !deliveryDate) issues.push("Check delivery date");
      if (billDate && deliveryDate && deliveryDate < billDate) issues.push("Delivery date is before bill date");
      if (!name || !particulars) issues.push("Missing customer or particulars");
      if (amount === null || amount <= 0) issues.push("Check loan amount");
      const deliveryNo = stringValue(value(row, "deliveryNo"));
      if (deliveryDate && !deliveryNo) issues.push("Delivery date recorded; delivery number missing");
      if (deliveryNo && !deliveryDate) issues.push("Delivery number recorded; delivery date missing");
      rows.push({ sheet: sheet.name, row: number, billNo, billDate, deliveryNo, deliveryDate, name, address: stringValue(value(row, "address")), particulars, phone: stringValue(value(row, "phone")), amount, issues });
    });
  }
  if (!rows.length) warnings.push("No bill rows found. Check the file and column headings.");
  const counts = new Map<string, number>();
  rows.forEach(row => { if (row.billNo) counts.set(row.billNo, (counts.get(row.billNo) ?? 0) + 1); });
  rows.forEach(row => { if ((counts.get(row.billNo) ?? 0) > 1) row.issues.push("Duplicate bill number in file"); });
  return { rows, warnings };
}
