import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import type { Bill } from "@/lib/types";

const mocks = vi.hoisted(() => ({ user: vi.fn(), profile: vi.fn(), bills: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.user, requireOwnerProfile: mocks.profile }));
vi.mock("@/lib/excel-report", () => ({ loadReportBills: mocks.bills }));
vi.mock("@/lib/accounts", async () => import("../../../../lib/accounts"));
vi.mock("@/lib/notice-report", async () => import("../../../../lib/notice-report"));
vi.mock("@/lib/notices", async () => import("../../../../lib/notices"));

const bill = (id: string, billNumber: number, billDate: string, patch: Partial<Bill> = {}): Bill => ({
  id, billNumber, billDate, status: "issued", customerCode: "C000001", customerName: "Example Customer", fatherName: "Parent", address: "Example Street", phone: "0123456789",
  items: [{ metal: "Gold", particulars: "Ring 2", grams: 2, assessedValue: 11000, loanAmount: 10000 }],
  totalAssessedValue: 11000, totalLoanAmount: 10000, amountInWords: "Rupees Ten Thousand Only", excelSyncStatus: "synced", createdAt: "2025-01-01T00:00:00Z", ...patch,
});
const request = (parameters: Record<string, string> = {}) => new Request(`http://localhost:3101/api/reports/notices?${new URLSearchParams({ month: "2026-10", notice: "1", account: "4", ...parameters })}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "owner" });
  mocks.profile.mockResolvedValue({ id: "profile-4" });
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
});
