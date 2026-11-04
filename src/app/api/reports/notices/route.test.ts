import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import type { Bill } from "@/lib/types";

const mocks = vi.hoisted(() => ({ user: vi.fn(), profile: vi.fn(), bills: vi.fn(), added: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.user, requireOwnerProfile: mocks.profile }));
vi.mock("@/lib/excel-report", () => ({ loadReportBills: mocks.bills }));
vi.mock("@/lib/accounts", async () => import("../../../../lib/accounts"));
vi.mock("@/lib/notice-report", async () => import("../../../../lib/notice-report"));
vi.mock("@/lib/notices", async () => import("../../../../lib/notices"));
vi.mock("@/lib/notice-messages", async () => import("../../../../lib/notice-messages"));
vi.mock("@/lib/business-updates", () => ({ billingToday: () => "2026-11-02" }));
vi.mock("@/lib/storage-mode", () => ({ localStorageEnabled: true }));
vi.mock("@/lib/notice-additions", () => ({ addedNoticeBills: mocks.added }));

const bill = (id: string, billNumber: number, billDate: string, patch: Partial<Bill> = {}): Bill => ({
  id, billNumber, billDate, status: "issued", customerCode: "C000001", customerName: "Example Customer", fatherName: "Parent", address: "Example Street", phone: "0123456789",
  items: [{ metal: "Gold", particulars: "Ring 2", grams: 2, assessedValue: 11000, loanAmount: 10000 }],
  totalAssessedValue: 11000, totalLoanAmount: 10000, amountInWords: "Rupees Ten Thousand Only", excelSyncStatus: "synced", createdAt: "2025-01-01T00:00:00Z", ...patch,
});
const request = (parameters: Record<string, string> = {}) => new Request(`http://localhost:3101/api/reports/notices?${new URLSearchParams({ month: "2026-10", notice: "1", account: "4", ...parameters })}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "owner" });
  mocks.added.mockResolvedValue([]);
  mocks.profile.mockResolvedValue({ id: "profile-4", business_name: "Sample Finance", phone: "9000000000" });
  mocks.bills.mockResolvedValue([
    bill("oct", 1, "2025-10-01"),
    bill("sep", 2, "2025-09-30", { status: "void", phone: "", customerCode: "C000002" }),
    bill("oct-delivered", 3, "2025-10-02", { deliveryNo: "1", deliveryDate: "2026-10-29" }),
    bill("sep-delivered", 4, "2025-09-01", { status: "void", deliveryNo: "2", deliveryDate: "2026-10-29" }),
  ]);
});

describe("notice Excel download", () => {
  it.each([1, 2])("exports only pending Notice %s rows with account scoping and rupee amounts", async stage => {
    const response = await GET(request({ notice: String(stage) }));
    expect(response.status).toBe(200);
    expect(mocks.profile).toHaveBeenCalledWith("owner", 4);
    expect(mocks.bills).toHaveBeenCalledWith("profile-4", { from: stage === 1 ? "2025-10-01" : "2025-09-01", to: stage === 1 ? "2025-10-31" : "2025-09-30", query: "" });
    expect(response.headers.get("content-disposition")).toContain(`Notice-${stage}-Account-4-2026-10.xlsx`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as never);
    const sheet = workbook.getWorksheet(`Notice ${stage}`)!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell("B2").value).toBe(stage);
    expect(sheet.getCell("C2").value).toBe(stage === 1 ? "C000001" : "C000002");
    expect(sheet.getCell("G2").value).toBe(stage === 1 ? "0123456789" : null);
    expect(sheet.getCell("H2").value).toBe("Gold");
    expect(sheet.getCell("I2").value).toBe("Gold: Ring 2");
    expect(sheet.getCell("J2").value).toContain("Pending delivery");
    expect(sheet.getCell("K2").value).toBe(10000);
    expect(sheet.getCell("K2").numFmt).toContain("₹");
    expect(sheet.getCell("L1").value).toBe("Message (English)");
    expect(sheet.getCell("M1").value).toBe("Message (Tamil)");
    const date = stage === 1 ? "01/10/2025" : "30/09/2025";
    expect(sheet.getCell("L2").value).toBe(stage === 1
      ? `Dear Example Customer, your jewellery pledged at Sample Finance under Bill No. 1 dated ${date} has completed one year. Kindly come soon, pay the amount and take back your jewellery. – Sample Finance`
      : `Dear Example Customer, this is the second and final notice. Your jewellery pledged at Sample Finance under Bill No. 2 dated ${date} has passed one year and one month. If it is not taken back by 22/11/2026, it will be sent for auction as per rules. Kindly come soon, pay the amount and take back your jewellery. – Sample Finance`);
    // The shop's own phone number is private and never goes into a message.
    for (const cell of ["L2", "M2"]) expect(String(sheet.getCell(cell).value)).not.toContain("9000000000");
    expect(sheet.getCell("M2").value).toContain(stage === 1 ? "ஒரு வருடம் நிறைவடைந்துவிட்டது" : "22/11/2026-க்குள்");
    expect(sheet.getCell("M2").value).toContain(`${date} அன்று Sample Finance-ல் சீட்டு எண் ${stage}`);
  });
  it("uses the same customer filter as the visible list and supports empty downloads", async () => {
    const response = await GET(request({ q: "C000002" }));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as never);
    expect(workbook.getWorksheet("Notice 1")!.rowCount).toBe(1);
  });
  it.each<Record<string, string>>([{ notice: "3" }, { month: "2026-13" }, { q: "a".repeat(201) }])("rejects invalid filters without loading bills: %j", async parameters => {
    expect((await GET(request(parameters))).status).toBe(400);
    expect(mocks.bills).not.toHaveBeenCalled();
  });
  it("rejects unauthorized access and missing profiles", async () => {
    mocks.user.mockRejectedValueOnce(new Error("Sign in is required."));
    expect((await GET(request())).status).toBe(400);
    expect(mocks.profile).not.toHaveBeenCalled();
    mocks.profile.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(400);
    expect(mocks.bills).not.toHaveBeenCalled();
  });
  it("includes bills the owner added by hand, once, in date order, and applies the same search", async () => {
    mocks.added.mockResolvedValue([bill("missed", 9, "2025-06-15", { customerName: "Missed Customer" }), bill("oct", 1, "2025-10-01")]);
    const response = await GET(request());
    expect(mocks.added).toHaveBeenCalledWith("profile-4", "2026-10", 1);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as never);
    const sheet = workbook.getWorksheet("Notice 1")!;
    expect(sheet.rowCount).toBe(3);
    expect([sheet.getCell("B2").value, sheet.getCell("B3").value]).toEqual([9, 1]);
    expect(sheet.getCell("D2").value).toBe("Missed Customer");
    const filtered = await GET(request({ q: "Missed" }));
    const searched = new ExcelJS.Workbook();
    await searched.xlsx.load(Buffer.from(await filtered.arrayBuffer()) as never);
    expect(searched.getWorksheet("Notice 1")!.rowCount).toBe(2);
    expect(searched.getWorksheet("Notice 1")!.getCell("B2").value).toBe(9);
  });
});
