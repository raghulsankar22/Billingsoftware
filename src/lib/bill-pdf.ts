import { jsPDF } from "jspdf";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currencyFont } from "./currency-font";
import { amountInWords } from "./money";
import type { Bill } from "./types";
import { calculateRepayment } from "./interest";

type BusinessDetails = { business_name: string; address: string; phone: string; logo_url?: string | null };
type SnapshottedBill = Bill & { businessSnapshot?: BusinessDetails };

const money = (value: number) => `₹ ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

export function createBillPdf(bill: SnapshottedBill, currentProfile: BusinessDetails, documentType: "finance" | "delivery" = "finance"): Uint8Array {
  const delivery = documentType === "delivery";
  if (delivery && (!bill.deliveryNo || !bill.deliveryDate)) throw new Error("Save delivery before printing the delivery bill.");
  const repayment = delivery ? bill.deliverySummary ?? calculateRepayment(bill.items, bill.billDate, bill.deliveryDate!) : null;
  if (repayment?.missingMetal) throw new Error("Choose Gold or Silver for every item before printing the delivery bill.");
  const business = bill.businessSnapshot ?? currentProfile;
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  pdf.addFileToVFS("BillCurrency.ttf", currencyFont);
  pdf.addFont("BillCurrency.ttf", "BillCurrency", "normal");
  const left = 15;
  let y = 17;

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
    pdf.text(`${business.business_name} - ${delivery ? `Delivery #${bill.deliveryNo}` : `Bill #${bill.billNumber}`}`, left, y);
    y += 9;
  }

  function tableHeader() {
    pdf.setFillColor(232, 239, 246);
    pdf.rect(left, y - 5, 180, 9, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("Metal", 18, y);
    pdf.text("Particulars", 44, y);
    pdf.text("Gram", 112, y);
    pdf.text("Total Value", 132, y);
    pdf.text("Amount", 169, y);
    y += 7;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text(business.business_name, 105, y, { align: "center", maxWidth: 175 });
  y += 7;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(pdf.splitTextToSize(business.address, 175), 105, y, { align: "center" });
  y += Math.max(5, (pdf.splitTextToSize(business.address, 175) as string[]).length * 4);
  pdf.text(`Phone: ${business.phone}`, 105, y, { align: "center" });
  y += 9;
  pdf.setLineWidth(0.4);
  pdf.line(left, y, 195, y);
  y += 8;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text(delivery ? "DELIVERY BILL" : "FINANCE BILL", 105, y, { align: "center" });
  y += 10;
  pdf.setFontSize(10);
  pdf.text(delivery ? `Delivery No.: ${bill.deliveryNo}` : `Bill No.: ${bill.billNumber}`, left, y);
  pdf.text(`Date: ${delivery ? bill.deliveryDate : bill.billDate}`, 148, y);
  y += 7;
  if (delivery) {
    line(`Original Bill No.: ${bill.billNumber}     Bill Date: ${bill.billDate}`, left, 180);
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
    const description = pdf.splitTextToSize(item.particulars, 62) as string[];
    const height = Math.max(8, description.length * 4.5 + 3);
    if (y + height > 254) { newPage(); tableHeader(); }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    if (item.metal) pdf.text(item.metal, 18, y);
    pdf.text(description, 44, y);
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
    for (const [label, amount] of [["Principal", repayment.principal], ["First-month interest charged at issue", repayment.initialInterest ?? 0], ["Interest to collect now", repayment.interest ?? 0], ["Total to collect now", repayment.total ?? repayment.principal]] as const) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.text(`${label}:`, left, y);
      currency(money(amount), 195, 80, 10);
      y += 7;
    }
    line("The first-month charge is assumed collected at issue and is excluded from the total above.", left, 180, 8);
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
    // Preserve the supplied English and Tamil conditions verbatim, including typography.
    const conditions = new Uint8Array(readFileSync(join(process.cwd(), "public", "bill-conditions.jpeg")));
    const image = pdf.getImageProperties(conditions);
    const width = 174;
    const height = width * image.height / image.width;
    y += 6;
    if (y + height > 282) newPage();
    pdf.addImage(conditions, "JPEG", (210 - width) / 2, y, width, height);
  }

  return new Uint8Array(pdf.output("arraybuffer"));
}
