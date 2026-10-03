import { describe, expect, it } from "vitest";
import { createBillPdf } from "./bill-pdf";
import type { Bill } from "./types";

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
  items: [{ particulars: "Gold ring", grams: 4.2, assessedValue: 12000, loanAmount: 8000 }],
  totalAssessedValue: 12000,
  totalLoanAmount: 8000,
  amountInWords: "Rupees Eight Thousand Only",
  excelSyncStatus: "pending",
  createdAt: "2026-10-03T10:00:00Z",
  businessSnapshot: { business_name: "Sample Finance", address: "1 Market Street, Chennai", phone: "04412345678" },
};

describe("bill PDF", () => {
  it("creates an A4 PDF from the issued business snapshot", () => {
    const bytes = createBillPdf(bill, { business_name: "Changed Name", address: "Other Address", phone: "000" });
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(3000);
  });
});
