import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";
import { randomUUID } from "node:crypto";
import { BillIssuanceConflict } from "../../../lib/bill-issuance";

const mocks = vi.hoisted(() => ({ local: false, cloud: true, requireUser: vi.fn(), profile: vi.fn(), rpc: vi.fn(), single: vi.fn(), query: { select: vi.fn(), eq: vi.fn(), single: vi.fn(), update: vi.fn() } }));
vi.mock("../../../lib/local-request", () => ({ withLocalSession: (handler: unknown) => handler }));
vi.mock("@/lib/storage-mode", () => ({ get localStorageEnabled() { return mocks.local; } }));
vi.mock("@/lib/cloud-mode", () => ({ cloudMultiUserEnabled: () => mocks.cloud, legacyIssuanceBlocked: (local: boolean) => !local && mocks.cloud }));
vi.mock("@/lib/accounts", () => ({ accountSlot: () => 1 }));
vi.mock("@/lib/validation", async () => import("../../../lib/validation"));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser, requireOwnerProfile: mocks.profile }));
vi.mock("@/lib/supabase", () => ({ createAdminSupabase: () => ({ rpc: mocks.rpc, from: () => mocks.query }) }));
vi.mock("@/lib/bills", () => ({ toBill: (value: unknown) => value, totals: () => ({ assessedValue: 110, loanAmount: 100 }) }));
vi.mock("@/lib/register-sync", () => ({ syncBillToRegister: vi.fn() }));
vi.mock("@/lib/bill-pdf-storage", () => ({ persistBillPdf: vi.fn() }));
vi.mock("@/lib/bill-history", () => ({ loadBillHistory: vi.fn() }));
afterEach(() => { mocks.local = false; mocks.cloud = true; vi.resetAllMocks(); });
beforeEach(() => {
  mocks.requireUser.mockResolvedValue({ id: "owner" }); mocks.profile.mockResolvedValue({ id: "profile" });
  mocks.rpc.mockResolvedValue({ data: { id: "saved-bill" }, error: null });
  mocks.query.select.mockReturnValue(mocks.query); mocks.query.eq.mockReturnValue(mocks.query); mocks.query.update.mockReturnValue(mocks.query); mocks.query.single.mockImplementation(mocks.single);
  mocks.single.mockResolvedValue({ data: { id: "saved-bill", bill_items: [] }, error: null });
});

const input = { billDate: "2026-11-03", customerName: "Sample Customer", fatherName: "Sample Parent", address: "123 Sample Street", items: [{ metal: "Gold", particulars: "Ring 1", grams: 2, assessedValue: 110, loanAmount: 100 }] };
const request = (key: string) => new Request("http://localhost/api/bills", { method: "POST", headers: { "x-billing-operation-id": key }, body: JSON.stringify(input) });

it("passes a validated stable request ID to local issuance", async () => {
  mocks.local = true; const operationId = randomUUID();
  const response = await POST(request(operationId));
  expect(response.status).toBe(201);
  expect(mocks.rpc).toHaveBeenCalledWith("create_bill", expect.objectContaining({ p_operation_id: operationId, p_owner_id: "owner" }));
});
it("refuses malformed request IDs before creating a bill", async () => {
  mocks.local = true;
  const response = await POST(request("bad"));
  expect(response.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  expect(await response.json()).toMatchObject({ issuanceCommitted: false });
});
it("distinguishes a rejected transaction from a lost response after commit", async () => {
  mocks.local = true;
  mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("Choose a metal") });
  const rejected = await POST(request(randomUUID()));
  expect(rejected.status).toBe(400); expect(await rejected.json()).toMatchObject({ issuanceCommitted: false });
  mocks.single.mockResolvedValueOnce({ data: null, error: new Error("Reload failed after commit") });
  const committed = await POST(request(randomUUID()));
  expect(committed.status).toBe(503); expect(await committed.json()).toMatchObject({ issuanceCommitted: true });
});
it("keeps conflicting or deleted requests locked instead of silently reissuing", async () => {
  mocks.local = true;
  mocks.rpc.mockResolvedValueOnce({ data: null, error: new BillIssuanceConflict("Already deleted") });
  const response = await POST(request(randomUUID()));
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ issuanceCommitted: true });
});

it("prevents the unfinished cloud mode from creating incomplete or unsynchronized bills", async () => {
  const request = new Request("http://localhost/api/bills", { method: "POST", body: "{}" });
  const response = await POST(request);
  expect(response.status).toBe(503);
  expect(mocks.requireUser).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
