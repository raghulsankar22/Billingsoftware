import { describe, expect, it } from "vitest";
import { createBillPdf } from "./bill-pdf";
import type { Bill } from "./types";
import { PDFDocument } from "pdf-lib";
import { billPdfTemplateVersion } from "./bill-conditions";

const bill: Bill = {
  id: "bill-1",
  billNumber: 42,
  status: "issued",
  billDate: "2026-10-03",
  deliveryNo: "D-17",
  deliveryDate: "2026-10-15",
  customerName: "Test Customer",
  fatherName: "Test Father",
  address: "12 Example Road, Chennai",
  phone: "9876543210",
  governmentId: "ID-123",
  items: [{ metal: "Gold", particulars: "Ring", grams: 4.2, assessedValue: 12000, loanAmount: 8000 }],
  totalAssessedValue: 12000,
  totalLoanAmount: 8000,
  amountInWords: "Rupees Eight Thousand Only",
  excelSyncStatus: "pending",
  createdAt: "2026-10-03T10:00:00Z",
  businessSnapshot: { business_name: "Sample Finance", address: "1 Market Street, Chennai", phone: "04412345678" },
};

describe("bill PDF", () => {
  it("includes the snapshotted license rather than another current license", async () => {
    const bytes = await createBillPdf({ ...bill, businessSnapshot: { ...bill.businessSnapshot!, license_number: "TN-OLD-123" } }, { ...bill.businessSnapshot!, license_number: "TN-NEW-456" });
    expect((await PDFDocument.load(bytes)).getKeywords()).toBe(JSON.stringify({ businessLicenseNumber: "TN-OLD-123" }));
  });
  it("creates a delivery bill PDF and requires a saved delivery number and date", async () => {
    const bytes = await createBillPdf(bill, bill.businessSnapshot!, "delivery");
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("%PDF");
    expect(Buffer.from(bytes).toString("latin1")).toContain("/ToUnicode");
    expect(Buffer.from(bytes).toString("latin1").match(/\/Subtype \/Image/g)).toHaveLength(1);
    await expect(createBillPdf({ ...bill, deliveryNo: "" }, bill.businessSnapshot!, "delivery")).rejects.toThrow("Save delivery");
  });
  it("creates an A4 PDF with typed conditions and a header logo", async () => {
    const bytes = await createBillPdf(bill, { business_name: "Changed Name", address: "Other Address", phone: "000" });
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(3000);
    // A Unicode character map is required for ₹ to survive PDF text extraction.
    expect(Buffer.from(bytes).toString("latin1")).toContain("/ToUnicode");
    expect(Buffer.from(bytes).toString("latin1")).toContain("/Subtype /Image");
    expect(Buffer.from(bytes).toString("latin1")).toContain("/DCTDecode");
    // Only the logo is an image. Conditions are embedded, shaped, selectable text.
    expect(Buffer.from(bytes).toString("latin1").match(/\/Subtype \/Image/g)).toHaveLength(1);
    expect((await PDFDocument.load(bytes)).getSubject()).toBe(billPdfTemplateVersion);
    expect(bytes.length).toBeLessThan(200_000);
  });
  it("keeps the complete typed conditions on long multi-page bills", async () => {
    const longBill = { ...bill, items: Array.from({ length: 50 }, () => ({ ...bill.items[0] })) };
    const bytes = await createBillPdf(longBill, bill.businessSnapshot!);
    const document = Buffer.from(bytes).toString("latin1");
    expect(document.match(/\/Subtype \/Image/g)).toHaveLength(1);
    expect(document.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
  });
});
