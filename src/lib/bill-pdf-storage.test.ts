import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { loadBillPdf } from "./bill-pdf-storage";
import { createBillPdf } from "./bill-pdf";
import { billPdfTemplateVersion } from "./bill-conditions";
import type { Bill } from "./types";

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
    expect((await PDFDocument.load(bytes)).getKeywords()).toBe(JSON.stringify({ businessLicenseNumber: "TN-123" }));
    expect(storage.upload).toHaveBeenCalledOnce();
  });
});
