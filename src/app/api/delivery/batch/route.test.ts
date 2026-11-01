import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), outputs: vi.fn(), sync: vi.fn(), user: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/storage-mode", () => ({ localStorageEnabled: true }));
vi.mock("@/lib/accounts", () => ({ accountSlot: () => 1 }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.user, requireOwnerProfile: mocks.profile }));
vi.mock("@/lib/supabase", () => ({ createAdminSupabase: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/bill-update-outputs", () => ({ refreshUpdatedBillOutputs: mocks.outputs }));
vi.mock("@/lib/register-sync", () => ({ syncAccountRegister: mocks.sync }));
vi.mock("@/lib/bills", async () => import("../../../../lib/bills"));
vi.mock("@/lib/validation", async () => import("../../../../lib/validation"));

const id = "00000000-0000-4000-8000-000000000001";
const snapshot = { id, profile_id: "profile", bill_number: 1, bill_date: "2026-10-28", status: "issued", customer_name: "Customer", father_name: "Parent", address: "123 Test Street", phone: "", total_assessed_value: 20000, total_loan_amount: 10000, delivery_no: "1", delivery_date: "2026-11-29", created_at: "2026-10-28T00:00:00Z", excel_sync_status: "pending", bill_items: [{ metal: "Gold", particulars: "Ring 2", grams: 3, assessed_value: 20000, loan_amount: 10000, sort_order: 0 }], delivery_summary: { chargedMonths: 1, lines: [], principal: 10000, initialInterest: 200, interest: 200, total: 10200, missingMetal: false } };
const request = () => new Request("http://localhost:3115/api/delivery/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deliveryDate: "2026-11-29", deliveries: [{ billId: id, billReceiptStatus: "has_bill", collectedByRelation: "self" }] }) });

beforeEach(() => {
  mocks.user.mockResolvedValue({ id: "local-owner" });
  mocks.profile.mockResolvedValue({ id: "profile", business_name: "Finance", address: "123 Test Street", phone: "1234567890" });
  mocks.rpc.mockResolvedValue({ data: [{ id, bill: snapshot }], error: null });
  mocks.outputs.mockResolvedValue([]); mocks.sync.mockResolvedValue(undefined);
  mocks.from.mockImplementation(() => {
    const chain = { update: () => chain, eq: () => chain, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
    return chain;
  });
});
afterEach(() => vi.resetAllMocks());

describe("multiple delivery saved responses", () => {
  it("uses committed snapshots without reloading bill rows after the transaction", async () => {
    const response = await POST(request());
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.bills[0]).toMatchObject({ id, deliveryNo: "1", excelSyncStatus: "synced", deliverySummary: { principal: 10000, interest: 200, total: 10200 } });
    expect(result.warnings).toEqual([]);
    expect(mocks.sync).toHaveBeenCalledOnce();
  });
  it("reports saved deliveries with a warning if document generation unexpectedly fails", async () => {
    mocks.outputs.mockRejectedValue(new Error("Bill was removed while producing documents"));
    const response = await POST(request()); const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.bills[0].deliveryNo).toBe("1");
    expect(result.warnings.join(" ")).toContain("delivery saved");
    expect(result.warnings.join(" ")).toContain("documents need a retry");
  });
  it("preserves saved status even when Excel and sync-status recording both fail", async () => {
    mocks.sync.mockRejectedValue(new Error("Excel is locked"));
    mocks.from.mockImplementation(() => { throw new Error("Record no longer exists"); });
    const response = await POST(request()); const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.bills[0]).toMatchObject({ deliveryNo: "1", excelSyncStatus: "failed" });
    expect(result.warnings.join(" ")).toContain("Deliveries are saved");
  });
});
