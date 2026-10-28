import { jsPDF } from "jspdf";
import { currencyFont } from "./currency-font";
import { amountInWords } from "./money";
import type { Bill } from "./types";

type BusinessDetails = { business_name: string; address: string; phone: string; logo_url?: string | null };
type SnapshottedBill = Bill & { businessSnapshot?: BusinessDetails };

const money = (value: number) => `₹ ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

export function createBillPdf(bill: SnapshottedBill, currentProfile: BusinessDetails): Uint8Array {
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
    pdf.text(`${business.business_name} - Bill #${bill.billNumber}`, left, y);
    y += 9;
  }

  function tableHeader() {
    pdf.setFillColor(232, 239, 246);
    pdf.rect(left, y - 5, 180, 9, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("Particulars", 18, y);
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
  pdf.text("FINANCE BILL", 105, y, { align: "center" });
  y += 10;
  pdf.setFontSize(10);
  pdf.text(`Bill No.: ${bill.billNumber}`, left, y);
  pdf.text(`Date: ${bill.billDate}`, 148, y);
  y += 7;
  if (bill.deliveryNo || bill.deliveryDate) {
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
    const description = pdf.splitTextToSize(item.particulars, 86) as string[];
    const height = Math.max(8, description.length * 4.5 + 3);
    if (y + height > 254) { newPage(); tableHeader(); }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(description, 18, y);
    pdf.text(String(item.grams), 112, y);
    currency(money(item.assessedValue), 162, 32);
    currency(money(item.loanAmount), 192, 27);
    y += height;
    pdf.setDrawColor(220, 226, 232);
    pdf.line(left, y - 4, 195, y - 4);
  }

  if (y + 51 > 275) newPage();
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  currency(`Total Value: ${money(bill.totalAssessedValue)}`, 105, 90, 10);
  currency(`Loan Amount: ${money(bill.totalLoanAmount)}`, 195, 77, 10);
  y += 8;
  line(`Amount in words: ${amountInWords(bill.totalLoanAmount)}`, left, 180, 10);
  y += 21;
  pdf.line(20, y, 78, y);
  pdf.line(132, y, 190, y);
  y += 5;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text("Business Signature", 49, y, { align: "center" });
  pdf.text("Customer Signature", 161, y, { align: "center" });

  return new Uint8Array(pdf.output("arraybuffer"));
}
