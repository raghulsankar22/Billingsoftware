import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({ user: vi.fn(), profile: vi.fn(), bills: vi.fn(), reports: vi.fn(), sync: vi.fn(), syncAll: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.user, requireOwnerProfile: mocks.profile }));
vi.mock("@/lib/accounts", () => import("../../../../lib/accounts"));
vi.mock("@/lib/excel-report", async () => ({ ...await import("../../../../lib/excel-report"), loadReportBills: mocks.bills }));
vi.mock("@/lib/all-account-register", async () => ({ ...await import("../../../../lib/all-account-register"), loadAccountReports: mocks.reports }));
vi.mock("@/lib/register-sync", () => ({ syncAccountRegister: mocks.sync, syncAllAccountRegisters: mocks.syncAll }));
vi.mock("@/lib/storage-mode", () => ({ localStorageEnabled: true }));
vi.mock("@/lib/local-database", () => ({ localDataDirectory: () => "sample-data" }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "signed-in-owner" });
  mocks.profile.mockResolvedValue({ id: "selected-profile" });
  mocks.bills.mockResolvedValue([]);
  mocks.reports.mockResolvedValue([{ profileId: "first", accountSlot: 1, bills: [] }, { profileId: "fourth", accountSlot: 4, bills: [] }]);
  mocks.syncAll.mockResolvedValue("sample-data/registers/All Accounts.xlsx");
});
const request = (suffix: string, method = "GET") => new Request("http://localhost:3103/api/reports/excel" + suffix, { method });

describe("Excel download and refresh", () => {
  it("exports all signed-in owner's accounts without applying dashboard date/search filters", async () => {
    const response = await GET(request("?scope=all&account=4&from=2026-11-02&q=ignored&owner=someone-else"));
    expect(response.status).toBe(200);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(Buffer.from(await response.arrayBuffer()) as never);
    expect(loaded.worksheets.map(sheet => sheet.name)).toEqual(["Account 1", "Account 4"]);
    expect(mocks.reports).toHaveBeenCalledWith("signed-in-owner");
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(response.headers.get("content-disposition")).toContain("All Accounts.xlsx");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("refreshes the whole workbook and returns only the authenticated user's saved location", async () => {
    const response = await POST(request("?scope=all&account=4", "POST"));
    expect(response.status).toBe(200);
    expect(mocks.syncAll).toHaveBeenCalledWith("signed-in-owner");
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true, savedTo: "sample-data/registers/All Accounts.xlsx" });
  });
  it("preserves selected-account downloads and refresh for existing callers", async () => {
    const response = await GET(request("?account=4"));
    expect(response.status).toBe(200);
    expect(mocks.profile).toHaveBeenCalledWith("signed-in-owner", 4);
    expect(mocks.bills).toHaveBeenCalledWith("selected-profile", { query: "", from: undefined, to: undefined });
    expect((await POST(request("?account=4", "POST"))).status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith("selected-profile");
  });
  it("does not return a partial workbook or successful refresh after an account fails", async () => {
    mocks.reports.mockRejectedValue(new Error("Account read failed"));
    const response = await GET(request("?scope=all"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Account read failed" });
    mocks.syncAll.mockRejectedValue(new Error("Close Excel and retry"));
    const refresh = await POST(request("?scope=all", "POST"));
    expect(refresh.status).toBe(400);
    expect(await refresh.json()).toEqual({ error: "Close Excel and retry" });
  });
  it("requires authentication before reading or refreshing any account", async () => {
    mocks.user.mockRejectedValue(new Error("Sign in is required"));
    expect((await GET(request("?scope=all"))).status).toBe(400);
    expect((await POST(request("?scope=all", "POST"))).status).toBe(400);
    expect(mocks.reports).not.toHaveBeenCalled();
    expect(mocks.syncAll).not.toHaveBeenCalled();
  });
});
