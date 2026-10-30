import { jsPDF } from "jspdf";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currencyFont } from "./currency-font";
import { amountInWords } from "./money";
import type { Bill } from "./types";
import { billReceiptLabels } from "./types";
import { calculateRepayment } from "./interest";
import { createConditionsBlock } from "./bill-conditions-pdf";
import { billPdfTemplateVersion } from "./bill-conditions";
import { billLicenseNumber } from "./business-license";
import { billPdfMetadata } from "./bill-pdf-metadata";

type BusinessDetails = { business_name: string; address: string; phone: string; logo_url?: string | null; license_number?: string | null };
type SnapshottedBill = Bill & { businessSnapshot?: BusinessDetails };

const money = (value: number) => `₹ ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

export async function createBillPdf(bill: SnapshottedBill, currentProfile: BusinessDetails, documentType: "finance" | "delivery" = "finance"): Promise<Uint8Array> {
  const delivery = documentType === "delivery";
  const hasRemarks = bill.items.some(item => Boolean(item.remarks?.trim()));
  if (delivery && (!bill.deliveryNo || !bill.deliveryDate)) throw new Error("Save delivery before printing the delivery bill.");
  const repayment = delivery ? bill.deliverySummary ?? calculateRepayment(bill.items, bill.billDate, bill.deliveryDate!) : null;
  if (repayment?.missingMetal) throw new Error("Choose Gold or Silver for every item before printing the delivery bill.");
  const business = bill.businessSnapshot ?? currentProfile;
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  pdf.setProperties({ subject: billPdfTemplateVersion, keywords: billPdfMetadata(bill, currentProfile, documentType) });
  pdf.addFileToVFS("BillCurrency.ttf", currencyFont);
  pdf.addFont("BillCurrency.ttf", "BillCurrency", "normal");
  const left = 15;
  const logo = new Uint8Array(readFileSync(join(process.cwd(), "public", "business-logo.jpg")));
  pdf.addImage(logo, "JPEG", left, 10, 24, 24);
  let y = 17;
  const licenseNumber = billLicenseNumber(bill, currentProfile);
  if (licenseNumber) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    const licenseLines = pdf.splitTextToSize(`License No.: ${licenseNumber}`, 140) as string[];
    pdf.text(licenseLines, 195, 10, { align: "right" });
    y += Math.max(0, (licenseLines.length - 1) * 3.5);
  }

  function currency(text: string, right: number, width: number, size = 9) {
    pdf.setFont("BillCurrency", "normal");
    pdf.setFontSize(size);
    // Amounts remain inside their columns even for large Indian-grouped values.
    const measured = pdf.getTextWidth(text);
    if (measured > width) pdf.setFontSize(size * width / measured);
    pdf.text(text, right, y, { align: "right" });
  }

  function line(text: string, x: number, width: number, size = 10, bold = false) {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const wrapped = pdf.splitTextToSize(text, width) as string[];
    pdf.text(wrapped, x, y);
    y += Math.max(5, wrapped.length * (size < 10 ? 4.2 : 5));
  }

  function newPage() {
    pdf.addPage();
    y = 18;
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.text(`${business.business_name} - ${delivery ? `Delivery #${bill.deliveryNo}` : `${bill.status === "void" ? "VOIDED " : ""}Bill #${bill.billNumber}`}`, left, y);
    y += 9;
  }

  function tableHeader() {
    pdf.setFillColor(232, 239, 246);
    pdf.rect(left, y - 5, 180, 9, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("Metal", 18, y);
    pdf.text("Particulars", hasRemarks ? 40 : 44, y);
    if (hasRemarks) pdf.text("Remarks", 74, y);
    pdf.text("Gram", 112, y);
    pdf.text("Total Value", 132, y);
    pdf.text("Amount", 169, y);
    y += 7;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text(business.business_name, 120, y, { align: "center", maxWidth: 145 });
  y += 7;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(pdf.splitTextToSize(business.address, 145), 120, y, { align: "center" });
  y += Math.max(5, (pdf.splitTextToSize(business.address, 145) as string[]).length * 4);
  pdf.text(`Phone: ${business.phone}`, 120, y, { align: "center" });
  y += 9;
  pdf.setLineWidth(0.4);
  pdf.line(left, y, 195, y);
  y += 8;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text(delivery ? "DELIVERY BILL" : "FINANCE BILL", 105, y, { align: "center" });
  y += 10;
  if (!delivery && bill.status === "void") {
    pdf.setFillColor(255, 240, 238);
    pdf.rect(left, y - 5, 180, 9, "F");
    pdf.setTextColor(180, 35, 24);
    pdf.text("VOIDED", 105, y + 1, { align: "center" });
    pdf.setTextColor(0);
    y += 12;
  }
  pdf.setFontSize(10);
  pdf.text(delivery ? `Delivery No.: ${bill.deliveryNo}` : `Bill No.: ${bill.billNumber}`, left, y);
  pdf.text(`Date: ${delivery ? bill.deliveryDate : bill.billDate}`, 148, y);
  y += 7;
  if (delivery) {
    line(`Original Bill No.: ${bill.billNumber}     Bill Date: ${bill.billDate}`, left, 180);
    line(`Delivery remarks: ${bill.deliveryBillReceiptStatus ? billReceiptLabels[bill.deliveryBillReceiptStatus] : "Not recorded"}`, left, 180, 9);
    if (bill.status === "void") line("Original bill status: Voided - delivery recorded", left, 180, 9);
  } else if (bill.deliveryNo || bill.deliveryDate) {
    line(`Delivery No.: ${bill.deliveryNo || "-"}     Delivery Date: ${bill.deliveryDate || "-"}`, left, 180);
  }
  line(`Name: ${bill.customerName}`, left, 180);
  line(`Father's Name: ${bill.fatherName}`, left, 180);
  line(`Address: ${bill.address}`, left, 180);
  const contactDetails = [bill.phone && `Phone: ${bill.phone}`, bill.governmentId && `Government ID: ${bill.governmentId}`].filter(Boolean).join("     ");
  if (contactDetails) line(contactDetails, left, 180);
  y += 6;
  tableHeader();

  for (const item of bill.items) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    const description = pdf.splitTextToSize(item.particulars, hasRemarks ? 30 : 62) as string[];
    const remarks = hasRemarks ? pdf.splitTextToSize(item.remarks?.trim() || "", 34) as string[] : [];
    const height = Math.max(8, Math.max(description.length, remarks.length) * 4.5 + 3);
    if (y + height > 254) { newPage(); tableHeader(); }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    if (item.metal) pdf.text(item.metal, 18, y);
    pdf.text(description, hasRemarks ? 40 : 44, y);
    if (remarks.length) pdf.text(remarks, 74, y);
    pdf.text(String(item.grams), 112, y);
    currency(money(item.assessedValue), 162, 32);
    currency(money(item.loanAmount), 192, 27);
    y += height;
    pdf.setDrawColor(220, 226, 232);
    pdf.line(left, y - 4, 195, y - 4);
  }

  if (y + (delivery ? 97 : 51) > 275) newPage();
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  if (repayment) {
    line(`Additional interest months: ${repayment.chargedMonths}`, left, 180, 10);
    line(`Monthly rates: ${[...new Set(repayment.lines.map(item => `${item.metal}: ${item.ratePercent}%`))].join(", ")}`, left, 180, 9);
    for (const [label, amount] of [["Principal", repayment.principal], ["Interest to collect now", repayment.interest ?? 0], ["Total to collect now", repayment.total ?? repayment.principal]] as const) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.text(`${label}:`, left, y);
      currency(money(amount), 195, 80, 10);
      y += 7;
    }
    line(`Amount in words: ${amountInWords(repayment.total ?? repayment.principal)}`, left, 180, 10);
  } else {
    currency(`Total Value: ${money(bill.totalAssessedValue)}`, 105, 90, 10);
    currency(`Loan Amount: ${money(bill.totalLoanAmount)}`, 195, 77, 10);
    y += 8;
    line(`Amount in words: ${amountInWords(bill.totalLoanAmount)}`, left, 180, 10);
  }
  y += 21;
  pdf.line(20, y, 78, y);
  pdf.line(132, y, 190, y);
  y += 5;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text("Business Signature", 49, y, { align: "center" });
  pdf.text("Customer Signature", 161, y, { align: "center" });

  if (!delivery) {
    const conditions = await createConditionsBlock();
    const pointsPerMillimetre = 72 / 25.4;
    y += 7;
    if (y + conditions.height / pointsPerMillimetre > 282) newPage();
    const document = await PDFDocument.load(pdf.output("arraybuffer"));
    const source = await PDFDocument.load(conditions.bytes);
    const sourcePage = source.getPage(0);
    const block = await document.embedPage(sourcePage, {
      left: 0, right: conditions.width,
      bottom: sourcePage.getHeight() - conditions.height, top: sourcePage.getHeight(),
    });
    const page = document.getPages().at(-1)!;
    page.drawPage(block, { x: left * pointsPerMillimetre, y: page.getHeight() - y * pointsPerMillimetre - conditions.height });
    return document.save({ useObjectStreams: false });
  }

  return new Uint8Array(pdf.output("arraybuffer"));
}
