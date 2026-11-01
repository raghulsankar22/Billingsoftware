import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ device: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/cloud-device-auth", () => ({ requireCloudDevice: mocks.device }));
vi.mock("@/lib/supabase", () => ({ createAdminSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/sync-bill", async () => import("../../../../../lib/sync-bill"));
vi.mock("@/lib/sync-outbox", async () => import("../../../../../lib/sync-outbox"));
vi.mock("@/lib/sync-conflicts", async () => import("../../../../../lib/sync-conflicts"));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

function example() {
  return { id: randomUUID(), deviceId: randomUUID(), accountId: randomUUID(), entityId: randomUUID(), entityType: "bill", action: "create", occurredAt: "2026-11-01T12:00:00Z", issuerEpoch: 1,
    payload: { billNumber: 1, billDate: "2026-11-01", customerName: "Test Customer", fatherName: "Test Parent", address: "Test address", phone: "", businessSnapshot: { business_name: "Test", address: "Test Road", phone: "1234567890" }, items: [{ id: randomUUID(), metal: "Gold", particulars: "Ring 1", grams: 2, assessedValue: 11000, loanAmount: 10000 }] } };
}
const request = (operation: unknown, secret: string, time = new Date().toISOString()) => new Request("https://billing.example.test/api/cloud/sync/bills", { method: "POST", headers: { "x-billing-device-secret": secret, "x-billing-device-time": time }, body: JSON.stringify(operation) });

it("is disabled until explicitly enabled for isolated development", async () => {
  const response = await POST(request(example(), randomBytes(32).toString("hex")));
  expect(response.status).toBe(404); expect(mocks.device).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});

it("sends a validated bill under the verified user and device with a server-computed hash", async () => {
  vi.stubEnv("BILLING_SYNC_BILL_EXPERIMENTAL", "1");
  const operation = example(), secret = randomBytes(32).toString("hex");
  mocks.device.mockResolvedValue({ userId: "owner-a", deviceId: operation.deviceId });
  mocks.rpc.mockResolvedValue({ data: { operationId: operation.id, billId: operation.entityId, billNumber: 1 }, error: null });
  const response = await POST(request(operation, secret));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ operationId: operation.id, accepted: true, clockWarning: false, superseded: false });
  const [name, args] = mocks.rpc.mock.calls[0];
  expect(name).toBe("sync_issue_bill_v3");
  expect(args).toMatchObject({ p_owner_id: "owner-a", p_device_id: operation.deviceId, p_profile_id: operation.accountId, p_bill_id: operation.entityId, p_bill_number: 1, p_epoch: 1, p_occurred_at: operation.occurredAt, p_token_hash: createHash("sha256").update(secret).digest("hex") });
  expect(args.p_operation_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(args)).not.toContain(secret);
});

it("does not write for a mismatched device, invalid bill, or a number conflict", async () => {
  vi.stubEnv("BILLING_SYNC_BILL_EXPERIMENTAL", "1");
  const operation = example(), secret = randomBytes(32).toString("hex");
  mocks.device.mockResolvedValue({ userId: "owner-a", deviceId: randomUUID() });
  expect((await POST(request(operation, secret))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.device.mockResolvedValue({ userId: "owner-a", deviceId: operation.deviceId });
  expect((await POST(request({ ...operation, payload: { ...operation.payload, items: [] } }, secret))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "Bill number does not match the next account number" } });
  expect((await POST(request(operation, secret))).status).toBe(409);
});

it("rejects an oversized operation before calling the database", async () => {
  vi.stubEnv("BILLING_SYNC_BILL_EXPERIMENTAL", "1");
  mocks.device.mockResolvedValue({ userId: "owner-a", deviceId: randomUUID() });
  const response = await POST(new Request("https://billing.example.test/api/cloud/sync/bills", { method: "POST", headers: { "x-billing-device-time": new Date().toISOString() }, body: "x".repeat(100001) }));
  expect(response.status).toBe(413);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("reports a device clock difference without dropping a successfully synced bill", async () => {
  vi.stubEnv("BILLING_SYNC_BILL_EXPERIMENTAL", "1");
  const operation = example(), secret = randomBytes(32).toString("hex");
  mocks.device.mockResolvedValue({ userId: "owner-a", deviceId: operation.deviceId });
  mocks.rpc.mockResolvedValue({ data: { operationId: operation.id, billId: operation.entityId, billNumber: 1 }, error: null });
  const response = await POST(request(operation, secret, new Date(Date.now() - 600000).toISOString()));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ accepted: true, clockWarning: true });
});

it("preserves a concurrent edit until its newer server version is reconciled", async () => {
  vi.stubEnv("BILLING_SYNC_BILL_EXPERIMENTAL", "1");
  const initial = example(), secret = randomBytes(32).toString("hex");
  const operation = { ...initial, action: "update", baseOperationId: randomUUID() };
  mocks.device.mockResolvedValue({ userId: "owner-a", deviceId: operation.deviceId });
  mocks.rpc.mockResolvedValue({ data: { operationId: operation.id, billId: operation.entityId, outcome: "superseded" }, error: null });
  const response = await POST(request(operation, secret));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ accepted: true, superseded: true });
  expect(mocks.rpc).toHaveBeenCalledWith("sync_edit_bill", expect.objectContaining({ p_owner_id: "owner-a", p_base_operation_id: operation.baseOperationId }));
  mocks.rpc.mockResolvedValueOnce({ data: { operationId: operation.id, billId: operation.entityId, outcome: "needs_review" }, error: null });
  expect((await POST(request(operation, secret))).status).toBe(409);
});
