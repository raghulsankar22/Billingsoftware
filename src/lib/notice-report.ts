import ExcelJS from "exceljs";
import { excelINRFormat } from "./money";
import { noticePeriod, type NoticeStage } from "./notices";
import type { Bill } from "./types";

export function noticeReportFilters(parameters: URLSearchParams) {
  const number = parameters.get("notice");
  if (number !== "1" && number !== "2") throw new Error("Choose Notice 1 or Notice 2.");
  const stage: NoticeStage = number === "1" ? 1 : 2;
  const month = parameters.get("month") ?? "";
  const range = noticePeriod(month, stage);
  const query = parameters.get("q")?.trim() ?? "";
  if (query.length > 200) throw new Error("Notice search must be at most 200 characters.");
  return { stage, month, range, query };
}

export function buildNoticeRegister(bills: readonly Bill[], stage: NoticeStage) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Notice ${stage}`);
  sheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Bill number", key: "bill", width: 14 },
    { header: "Customer ID", key: "customerId", width: 16 },
    { header: "Customer name", key: "name", width: 25 },
    { header: "Father's name", key: "fatherName", width: 25 },
    { header: "Customer address", key: "address", width: 40 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Metal", key: "metal", width: 18 },
    { header: "Particulars", key: "particulars", width: 40 },
    { header: "Status", key: "status", width: 28 },
    { header: "Loan amount", key: "amount", width: 20 },
  ];
  for (const bill of bills) sheet.addRow({
    date: bill.billDate.split("-").reverse().join("/"), bill: bill.billNumber,
    customerId: bill.customerCode ?? "", name: bill.customerName, fatherName: bill.fatherName,
    address: bill.address, phone: bill.phone || null,
    metal: [...new Set(bill.items.map(item => item.metal ?? "Not set"))].join(", "),
    particulars: bill.items.map(item => `${item.metal ? `${item.metal}: ` : ""}${item.particulars}`).join("\n"),
    status: bill.status === "void" ? "Voided · Pending delivery" : "Pending delivery", amount: bill.totalLoanAmount,
  });
  sheet.getColumn("amount").numFmt = excelINRFormat;
  sheet.getColumn("phone").numFmt = "@";
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17304F" } };
  sheet.eachRow(row => { row.alignment = { vertical: "top", wrapText: true }; });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "K1" };
  return workbook;
}
