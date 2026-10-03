import ExcelJS from "exceljs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encrypt } from "./crypto";
import { markBillVoidInGoogleDrive, syncBillToGoogleDrive } from "./google-drive";
import type { Bill } from "./types";

const mocks = vi.hoisted(() => ({ db: vi.fn(), load: vi.fn() }));
vi.mock("./supabase", () => ({ createAdminSupabase: mocks.db }));
vi.mock("./excel-report", async (original) => ({ ...await original<typeof import("./excel-report")>(), loadReportBills: mocks.load }));

const bill: Bill = { id: "bill", billNumber: 101, status: "issued", billDate: "2026-10-03", customerName: "Authoritative customer", fatherName: "Father", address: "Kanchipuram", phone: "1234567890", items: [{ particulars: "Gold", grams: 2, assessedValue: 4000, loanAmount: 3000 }], totalAssessedValue: 4000, totalLoanAmount: 3000, amountInWords: "Three thousand", excelSyncStatus: "pending", createdAt: "2026-10-03" };
let rpc: ReturnType<typeof vi.fn>;
let updates: Record<string, unknown>[];
let events: string[];
let failIdSave: boolean;
let fileId: string | null;
let fetcher: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-encryption-key-32-characters-long");
  vi.stubEnv("GOOGLE_CLIENT_ID", "client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "private-client-secret");
  updates = []; events = []; failIdSave = false; fileId = null;
  rpc = vi.fn(async (name: string) => ({ data: name === "acquire_drive_sync", error: null }));
  mocks.db.mockReturnValue({ rpc, from: () => ({
    select: () => ({ eq: () => {
      const result = () => Promise.resolve({ data: { refresh_token_encrypted: encrypt("private-refresh-token"), workbook_file_id: fileId, workbook_name: "Register.xlsx" }, error: null });
      return { maybeSingle: result, single: result };
    } }),
    update: (value: Record<string, unknown>) => ({ eq: async () => {
      updates.push(value); events.push("save");
      if (value.workbook_file_id && failIdSave) return { error: { message: "database failure" } };
      return { error: null };
    } }),
  }) });
  mocks.load.mockResolvedValue([bill]);
  fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    events.push(url.includes("upload/") ? "upload" : "fetch");
    if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "private-access-token" });
    if (url.includes("generateIds")) return Response.json({ ids: ["generated-id"] });
    if (url.includes("?fields=id") && !url.includes("upload/")) return new Response(null, { status: fileId ? 200 : 404 });
    if (init?.method === "POST" || init?.method === "PATCH") return Response.json({ id: "generated-id" });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("does not call Google or release another worker's lease on contention", async () => {
  rpc.mockResolvedValue({ data: false, error: null });
  await expect(syncBillToGoogleDrive("profile", bill)).rejects.toThrow(/syncing/);
  expect(fetcher).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("persists a generated ID before uploading a valid workbook in multipart", async () => {
  await syncBillToGoogleDrive("profile", bill);
  expect(updates[0]).toEqual({ workbook_file_id: "generated-id" });
  expect(events.indexOf("save")).toBeLessThan(events.indexOf("upload"));
  const [url, init] = fetcher.mock.calls.find(([url]) => url.includes("upload/"))!;
  expect(url).toContain("uploadType=multipart");
  expect(init.method).toBe("POST");
  const body = init.body as Buffer;
  expect(body.toString("utf8")).toContain('"id":"generated-id"');
  expect(body.toString("utf8")).toContain('"name":"Register.xlsx"');
  const start = body.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const end = body.lastIndexOf(Buffer.from("\r\n--billing_"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(body.subarray(start, end)).buffer);
  expect(workbook.getWorksheet("Bills")!.getCell("F2").value).toBe(bill.customerName);
  expect(mocks.load).toHaveBeenCalledWith("profile", { query: "" });
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["acquire_drive_sync", "release_drive_sync"]);
  expect(rpc.mock.calls[1][1]).toEqual(rpc.mock.calls[0][1]);
});

it("replaces an existing register with all authoritative rows including styled void bills", async () => {
  fileId = "existing-id";
  mocks.load.mockResolvedValue([bill, { ...bill, id: "void-bill", billNumber: 102, customerName: "Void customer", status: "void" }]);
  await markBillVoidInGoogleDrive("profile", 102);
  const [url, init] = fetcher.mock.calls.find(([url]) => url.includes("upload/"))!;
  expect(url).toContain("existing-id?uploadType=media");
  expect(init.method).toBe("PATCH");
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Uint8Array.from(init.body as Buffer).buffer);
  const sheet = workbook.getWorksheet("Bills")!;
  expect(sheet.getCell("D3").value).toBe(102);
  expect(sheet.getCell("F3").value).toBe("Void customer");
  expect(sheet.getRow(3).font.strike).toBe(true);
  expect(fetcher.mock.calls.some(([url]) => url.includes("generateIds"))).toBe(false);
});

it("does not upload when the workbook ID cannot be persisted and releases the lease", async () => {
  failIdSave = true;
  await expect(syncBillToGoogleDrive("profile", bill)).rejects.toThrow(/save Google Drive workbook ID/);
  expect(fetcher.mock.calls.some(([url]) => url.includes("upload/"))).toBe(false);
  expect(rpc).toHaveBeenLastCalledWith("release_drive_sync", expect.any(Object));
});

it("returns a safe token failure without exposing Google response credentials and releases the lease", async () => {
  fetcher.mockResolvedValue(new Response("private-refresh-token private-client-secret private-access-token", { status: 400 }));
  await expect(syncBillToGoogleDrive("profile", bill)).rejects.toThrow(/^Reconnect Google Drive to renew access\.$/);
  expect(rpc).toHaveBeenLastCalledWith("release_drive_sync", expect.any(Object));
  expect(updates).toEqual([]);
});

it("releases its lease when a Drive upload is denied", async () => {
  const normal = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => url.includes("upload/") ? new Response("private-access-token", { status: 403 }) : normal(url, init));
  await expect(syncBillToGoogleDrive("profile", bill)).rejects.toThrow(/access was denied/);
  expect(rpc).toHaveBeenLastCalledWith("release_drive_sync", expect.any(Object));
});
