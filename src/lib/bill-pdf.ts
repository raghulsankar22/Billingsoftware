import { jsPDF } from "jspdf";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currencyFont } from "./currency-font";
import { amountInWords } from "./money";
import type { Bill } from "./types";
import { billReceiptLabels, collectedByText } from "./types";
import { calculateRepayment } from "./interest";
import { createConditionsBlock } from "./bill-conditions-pdf";
import { billPdfTemplateVersion } from "./bill-conditions";
import { billLicenseNumber } from "./business-license";
import { billPdfMetadata } from "./bill-pdf-metadata";
import { formatParticulars } from "./jewellery";
import { createTextBlocks, pdfTextKey, type PdfTextRequest } from "./jewellery-particulars-pdf";
import { containsTamil } from "./english-records";

type BusinessDetails = { business_name: string; address: string; phone: string; logo_url?: string | null; license_number?: string | null };
type SnapshottedBill = Bill & { businessSnapshot?: BusinessDetails };

const money = (value: number) => `₹ ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

export async function createBillPdf(bill: SnapshottedBill, currentProfile: BusinessDetails, documentType: "finance" | "delivery" = "finance"): Promise<Uint8Array> {
  const delivery = documentType === "delivery";
  const hasRemarks = bill.items.some(item => Boolean(item.remarks?.trim()));
  if (delivery && (!bill.deliveryNo || !bill.deliveryDate)) throw new Error("Save delivery before printing the delivery bill.");
  const repayment = delivery ? bill.deliverySummary ?? (bill.historicalDelivery ? null : calculateRepayment(bill.items, bill.billDate, bill.deliveryDate!)) : null;
  if (repayment?.missingMetal) throw new Error("Choose Gold or Silver for every item before printing the delivery bill.");
  const business = bill.businessSnapshot ?? currentProfile;
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  pdf.setProperties({ subject: billPdfTemplateVersion, keywords: billPdfMetadata(bill, currentProfile, documentType) });
  pdf.addFileToVFS("BillCurrency.ttf", currencyFont);
  pdf.addFont("BillCurrency.ttf", "BillCurrency", "normal");
  const left = 15;
  const pointsPerMillimetre = 72 / 25.4;
  const descriptions = bill.items.map(item => formatParticulars(item.particulars));
  const particularsWidth = hasRemarks ? 30 : 62;
  const licenseNumber = billLicenseNumber(bill, currentProfile);
  const continuation = `${business.business_name} - ${delivery ? `Delivery #${bill.deliveryNo}` : `${bill.status === "void" ? "VOIDED " : ""}Bill #${bill.billNumber}`}`;
  const contactDetails = [bill.phone && `Phone: ${bill.phone}`, bill.governmentId && `Government ID: ${bill.governmentId}`].filter(Boolean).join("     ");
  const requests: PdfTextRequest[] = [
    ...descriptions.map(value => ({ value, width: particularsWidth * pointsPerMillimetre })),
    ...bill.items.filter(item => containsTamil(item.remarks ?? "")).map(item => ({ value: item.remarks!.trim(), width: 34 * pointsPerMillimetre })),
    { value: business.business_name, width: 145 * pointsPerMillimetre, size: 18, bold: true, align: "center" },
    { value: business.address, width: 145 * pointsPerMillimetre, align: "center" },
    { value: continuation, width: 180 * pointsPerMillimetre, bold: true },
    { value: `License No.: ${licenseNumber}`, width: 140 * pointsPerMillimetre, size: 8, align: "right" },
    ...[`Name: ${bill.customerName}`, `Father's Name / Husband's Name: ${bill.fatherName || (bill.historicalImport ? "Not recorded" : "")}`, `Address: ${bill.address}`, contactDetails].map(value => ({ value, width: 180 * pointsPerMillimetre, size: 10 })),
    { value: `Jewellery taken by: ${collectedByText(bill) || "Not recorded"}`, width: 180 * pointsPerMillimetre },
  ];
  const particulars = await createTextBlocks(requests);
  const blockFor = (value: string, width: number, size = 9, bold = false, align: PdfTextRequest["align"] = "left") => pdfTextKey({ value, width: width * pointsPerMillimetre, size, bold, align });
  const placements: { key: string; page: number; top: number; left: number }[] = [];
  function typedText(value: string, x: number, top: number, width: number, size = 9, bold = false, align: PdfTextRequest["align"] = "left") {
    const key = blockFor(value, width, size, bold, align);
    const block = particulars.blocks.get(key);
    if (!block) throw new Error("Missing prepared print text.");
    placements.push({ key, page: pdf.getNumberOfPages() - 1, top: top - size * 0.3556, left: x - (align === "center" ? width / 2 : align === "right" ? width : 0) });
    return block.height / pointsPerMillimetre;
  }
  const logo = new Uint8Array(readFileSync(join(process.cwd(), "public", "business-logo.jpg")));
  pdf.addImage(logo, "JPEG", left, 10, 24, 24);
  let y = 17;
  if (licenseNumber) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    if (containsTamil(licenseNumber)) {
      const height = typedText("License No.: " + licenseNumber, 195, 10, 140, 8, false, "right");
      y += Math.max(0, height - 3.5);
    } else {
      const licenseLines = pdf.splitTextToSize("License No.: " + licenseNumber, 140) as string[];
      pdf.text(licenseLines, 195, 10, { align: "right" });
      y += Math.max(0, (licenseLines.length - 1) * 3.5);
    }
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
    if (containsTamil(text)) {
      y += Math.max(5, typedText(text, x, y, width, size, bold));
      return;
    }
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
    if (containsTamil(continuation)) y += typedText(continuation, left, y, 180, 9, true) + 3;
    else { pdf.text(continuation, left, y); y += 9; }
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
  if (containsTamil(business.business_name)) y += Math.max(7, typedText(business.business_name, 120, y, 145, 18, true, "center"));
  else { pdf.text(business.business_name, 120, y, { align: "center", maxWidth: 145 }); y += 7; }
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  if (containsTamil(business.address)) y += Math.max(5, typedText(business.address, 120, y, 145, 9, false, "center"));
  else {
    pdf.text(pdf.splitTextToSize(business.address, 145), 120, y, { align: "center" });
    y += Math.max(5, (pdf.splitTextToSize(business.address, 145) as string[]).length * 4);
  }
  y += 4;
  pdf.setLineWidth(0.4);
  pdf.line(left, y, 195, y);
  y += 8;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text(delivery ? "DELIVERY BILL" : "FINANCE BILL", 105, y, { align: "center" });
  y += 10;
  if (bill.historicalImport) line("Imported historical record - original physical bill not included", left, 180, 9);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
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
    line(`Jewellery taken by: ${collectedByText(bill) || "Not recorded"}`, left, 180, 9);
    if (bill.status === "void") line("Original bill status: Voided - delivery recorded", left, 180, 9);
  } else if (bill.deliveryNo || bill.deliveryDate) {
    line(`Delivery No.: ${bill.deliveryNo || "-"}     Delivery Date: ${bill.deliveryDate || "-"}`, left, 180);
  }
  line(`Name: ${bill.customerName}`, left, 180);
  line(`Father's Name / Husband's Name: ${bill.fatherName || (bill.historicalImport ? "Not recorded" : "")}`, left, 180);
  line(`Address: ${bill.address}`, left, 180);
  if (contactDetails) line(contactDetails, left, 180);
  y += 6;
  tableHeader();

  for (const [itemIndex, item] of bill.items.entries()) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    const description = descriptions[itemIndex];
    const descriptionHeight = particulars.blocks.get(blockFor(description, particularsWidth))!.height / pointsPerMillimetre;
    const remarkText = item.remarks?.trim() || "";
    const tamilRemarks = hasRemarks && containsTamil(remarkText);
    const remarks = hasRemarks && !tamilRemarks ? pdf.splitTextToSize(remarkText, 34) as string[] : [];
    const remarkHeight = tamilRemarks ? particulars.blocks.get(blockFor(remarkText, 34))!.height / pointsPerMillimetre : remarks.length * 4.5;
    const height = Math.max(8, descriptionHeight + 3, remarkHeight + 3);
    if (y + height > 254) { newPage(); tableHeader(); }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    if (item.metal) pdf.text(item.metal, 18, y);
    typedText(description, hasRemarks ? 40 : 44, y, particularsWidth);
    if (tamilRemarks) typedText(remarkText, 74, y, 34);
    if (remarks.length) pdf.text(remarks, 74, y);
    pdf.text(item.grams === null ? "-" : String(item.grams), 112, y);
    currency(item.assessedValue === null ? "-" : money(item.assessedValue), 162, 32);
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
    if (bill.totalAssessedValue === null) {
      // The embedded currency font is a subset without the letters of this label.
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.text("Total Value: Not recorded", 105, y, { align: "right" });
    } else currency(`Total Value: ${money(bill.totalAssessedValue)}`, 105, 90, 10);
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

  const conditions = delivery ? null : await createConditionsBlock();
  if (conditions) {
    y += 7;
    if (y + conditions.height / pointsPerMillimetre > 282) newPage();
  }
  const document = await PDFDocument.load(pdf.output("arraybuffer"));
  const source = await PDFDocument.load(particulars.bytes);
  const embedded = new Map<string, Awaited<ReturnType<typeof document.embedPage>>>();
  for (const placement of placements) {
    const dimensions = particulars.blocks.get(placement.key)!;
    let block = embedded.get(placement.key);
    if (!block) {
      const sourcePage = source.getPage(dimensions.pageIndex);
      block = await document.embedPage(sourcePage, { left: 0, right: dimensions.width, bottom: sourcePage.getHeight() - dimensions.height, top: sourcePage.getHeight() });
      embedded.set(placement.key, block);
    }
    const page = document.getPage(placement.page);
    page.drawPage(block, { x: placement.left * pointsPerMillimetre, y: page.getHeight() - placement.top * pointsPerMillimetre - dimensions.height });
  }
  if (conditions) {
    const conditionsSource = await PDFDocument.load(conditions.bytes);
    const sourcePage = conditionsSource.getPage(0);
    const block = await document.embedPage(sourcePage, {
      left: 0, right: conditions.width,
      bottom: sourcePage.getHeight() - conditions.height, top: sourcePage.getHeight(),
    });
    const page = document.getPages().at(-1)!;
    page.drawPage(block, { x: left * pointsPerMillimetre, y: page.getHeight() - y * pointsPerMillimetre - conditions.height });
  }
  return document.save({ useObjectStreams: false });
}
