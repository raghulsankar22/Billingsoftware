import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { loadBillPdf } from "./bill-pdf-storage";
import { createBillPdf } from "./bill-pdf";
import { billPdfTemplateVersion } from "./bill-conditions";
import type { Bill } from "./types";
import { billPdfMetadata } from "./bill-pdf-metadata";

const storage = vi.hoisted(() => {
  const query = { error: null, eq: vi.fn() };
  query.eq.mockReturnValue(query);
  return { download: vi.fn(), upload: vi.fn(), update: vi.fn(() => query) };
});
vi.mock("./supabase", () => ({ createAdminSupabase: () => ({
  storage: { from: () => ({ download: storage.download, upload: storage.upload }) },
  from: () => ({ update: storage.update }),
}) }));

const profile = { id: "profile", business_name: "Sample Finance", address: "Chennai", phone: "1234567890" };
const bill: Bill = {
  id: "sample", billNumber: 1, status: "issued", billDate: "2026-10-28",
  customerName: "Customer", fatherName: "Father", address: "Chennai", phone: "",
  items: [{ metal: "Gold", particulars: "Ring", grams: 1, assessedValue: 1000, loanAmount: 500 }],
  totalAssessedValue: 1000, totalLoanAmount: 500, amountInWords: "Rupees Five Hundred Only",
  excelSyncStatus: "synced", createdAt: "2026-10-28T00:00:00Z",
};

describe("bill PDF template upgrades", () => {
  beforeEach(() => { vi.clearAllMocks(); storage.upload.mockResolvedValue({ error: null }); });

  it("regenerates an issued bill's cached PDF after the bill is voided", async () => {
    const current = await createBillPdf(bill, profile);
    storage.download.mockResolvedValue({ data: new Blob([Buffer.from(current)]), error: null });
    const bytes = await loadBillPdf(profile, { ...bill, status: "void" }, "profile/issued.pdf");
    expect(storage.upload).toHaveBeenCalledOnce();
    expect(bytes).not.toEqual(current);
  });

  it("does not reuse a finance document as a delivery receipt", async () => {
    const delivery = { ...bill, deliveryNo: "1", deliveryDate: "2026-11-29" };
    const current = await createBillPdf(delivery, profile);
    storage.download.mockResolvedValue({ data: new Blob([Buffer.from(current)]), error: null });
    await loadBillPdf(profile, delivery, "profile/finance.pdf", "delivery");
    expect(storage.upload).toHaveBeenCalledOnce();
  });

  it("reuses a PDF that already has the current text and logo template", async () => {
    const current = await createBillPdf(bill, profile);
    storage.download.mockResolvedValue({ data: new Blob([Buffer.from(current)]), error: null });
    expect(await loadBillPdf(profile, bill, "profile/current.pdf")).toEqual(current);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("replaces an older photo-based PDF with a new version without overwriting the original", async () => {
    const old = await PDFDocument.create();
    old.addPage();
    storage.download.mockResolvedValue({ data: new Blob([Buffer.from(await old.save())]), error: null });
    const bytes = await loadBillPdf(profile, bill, "profile/original.pdf");
    expect((await PDFDocument.load(bytes)).getSubject()).toBe(billPdfTemplateVersion);
    expect(storage.upload).toHaveBeenCalledOnce();
    expect(storage.upload.mock.calls[0][0]).not.toBe("profile/original.pdf");
    expect(storage.upload.mock.calls[0][2]).toEqual({ contentType: "application/pdf", upsert: false });
    expect(storage.update).toHaveBeenCalledWith({ pdf_storage_path: storage.upload.mock.calls[0][0], pdf_error: null });
  });
  it("refreshes a legacy bill PDF after its business license is added", async () => {
    const old = await createBillPdf(bill, profile);
    storage.download.mockResolvedValue({ data: new Blob([Buffer.from(old)]), error: null });
    const bytes = await loadBillPdf({ ...profile, license_number: "TN-123" }, bill, "profile/old.pdf");
    expect((await PDFDocument.load(bytes)).getKeywords()).toBe(billPdfMetadata(bill, { ...profile, license_number: "TN-123" }, "finance"));
    expect(storage.upload).toHaveBeenCalledOnce();
  });
  it("refreshes a saved delivery PDF from the interest-at-issue template", async () => {
    const delivery = { ...bill, deliveryNo: "1", deliveryDate: "2026-11-29" };
    const old = await PDFDocument.load(await createBillPdf(delivery, profile, "delivery"));
    old.setSubject("finance-billing-text-conditions-license-v2");
    storage.download.mockResolvedValue({ data: new Blob([Buffer.from(await old.save())]), error: null });
    const bytes = await loadBillPdf(profile, delivery, "profile/old-delivery.pdf", "delivery");
    expect((await PDFDocument.load(bytes)).getSubject()).toBe(billPdfTemplateVersion);
    expect(storage.upload).toHaveBeenCalledOnce();
    expect(storage.update).toHaveBeenCalledWith({ delivery_pdf_storage_path: storage.upload.mock.calls[0][0], delivery_pdf_error: null });
  });
});
