import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt, decrypt } from "./crypto";
import { syncBillToOneDrive, markBillVoidInOneDrive } from "./onedrive";
import { createRegister, appendRegisterBill } from "./register";
import type { Bill } from "./types";

const db = vi.hoisted(() => ({ connection: {} as Record<string, string>, update: vi.fn(), error: null as unknown }));
vi.mock("./supabase", () => ({ createAdminSupabase: () => ({ from: () => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.connection, error: null }) }) }),
  update: (value: unknown) => { db.update(value); return { eq: () => ({ eq: async () => ({ error: db.error }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: db.error }).then(resolve) }) }; },
}) }) }));

const bill: Bill = { id: "bill-1", billNumber: 1, billDate: "2026-10-03", customerName: "Customer", fatherName: "Parent", address: "Address", phone: "0123456789", items: [{ particulars: "Gold", grams: 1, assessedValue: 100, loanAmount: 80 }], totalAssessedValue: 100, totalLoanAmount: 80, amountInWords: "Eighty", status: "issued", excelSyncStatus: "pending", createdAt: "2026-10-03" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const token = () => json({ access_token: "access", refresh_token: "rotated" });

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-encryption-key-32-characters-long");
  vi.stubEnv("MICROSOFT_CLIENT_ID", "client"); vi.stubEnv("MICROSOFT_CLIENT_SECRET", "secret");
  db.connection = { refresh_token_encrypted: encrypt("original"), workbook_path: "Register.xlsx" };
  db.update.mockClear(); db.error = null;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("OneDrive register sync", () => {
  it("persists rotated refresh tokens and writes a real table containing the bill", async () => {
    let uploaded: Buffer | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/token")) return token();
      if (init?.method === "PUT") { uploaded = init.body as Buffer; return json({ id: "file" }); }
      return json({ error: { code: "itemNotFound" } }, 404);
    }));
    await syncBillToOneDrive("profile", bill);
    expect(db.update).toHaveBeenCalled();
    expect(decrypt(db.update.mock.calls[0][0].refresh_token_encrypted)).toBe("rotated");
    const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(uploaded! as never);
    expect(loaded.getWorksheet("Bills")!.getTable("Bills")).toMatchObject({ table: { tableRef: "A1:I2" } });
  });

  it("re-reads and merges after a competing upload, preserving both bills without duplicates", async () => {
    const initial = createRegister(); appendRegisterBill(initial, { ...bill, billNumber: 2 });
    const newer = createRegister(); appendRegisterBill(newer, { ...bill, billNumber: 2 }); appendRegisterBill(newer, { ...bill, billNumber: 3 });
    const snapshots = [await initial.xlsx.writeBuffer(), await newer.xlsx.writeBuffer()];
    let reads = 0, uploads = 0; let uploaded: Buffer | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/token")) return token();
      if (init?.method === "PUT") { uploads++; uploaded = init.body as Buffer; return uploads === 1 ? json({}, 412) : json({}); }
      if (url.includes("/content")) return new Response(Buffer.from(snapshots[Math.max(0, Math.min(reads - 1, 1))]));
      reads++; return json({ id: "file", eTag: `etag-${reads}` });
    }));
    await syncBillToOneDrive("profile", bill);
    expect(uploads).toBe(2);
    const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(uploaded! as never);
    expect(loaded.getWorksheet("Bills")!.getColumn(4).values.slice(2)).toEqual([2, 3, 1]);
    appendRegisterBill(loaded, bill);
    expect(loaded.getWorksheet("Bills")!.rowCount).toBe(4);
  });

  it("does not expose Microsoft token responses as user errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invalid_grant", secret: "TOKEN_SECRET" }, 400)));
    await expect(syncBillToOneDrive("profile", bill)).rejects.toThrow(/Reconnect/);
    await expect(syncBillToOneDrive("profile", bill)).rejects.not.toThrow("TOKEN_SECRET");
  });

  it("marks a void row once and keeps the bill number and amount", async () => {
    const initial = createRegister(); appendRegisterBill(initial, bill);
    let content = Buffer.from(await initial.xlsx.writeBuffer());
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/token")) return token();
      if (init?.method === "PUT") { content = Buffer.from(init.body as Buffer); return json({}); }
      if (url.includes("/content")) return new Response(content);
      return json({ id: "file", eTag: "etag" });
    }));
    await markBillVoidInOneDrive("profile", bill.billNumber);
    await markBillVoidInOneDrive("profile", bill.billNumber);
    const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(content as never);
    const row = loaded.getWorksheet("Bills")!.getRow(2);
    expect(row.getCell(7).value).toMatch(/^VOID — (?!VOID)/);
    expect(row.getCell(4).value).toBe(1); expect(row.getCell(9).value).toBe(80);
    expect(row.font.strike).toBe(true);
  });

  it("retries Microsoft throttling using Retry-After and fails safely after repeated conflicts", async () => {
    const workbook = createRegister(); const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    let reads = 0, uploads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/token")) return token();
      if (init?.method === "PUT") { uploads++; return json({}, 412); }
      if (url.includes("/content")) return new Response(bytes);
      reads++;
      return reads === 1 ? new Response("", { status: 429, headers: { "Retry-After": "0" } }) : json({ id: "file", eTag: "etag" });
    }));
    await expect(syncBillToOneDrive("profile", bill)).rejects.toThrow(/changed during sync/);
    expect(uploads).toBe(3); expect(reads).toBe(4);
  });
});
