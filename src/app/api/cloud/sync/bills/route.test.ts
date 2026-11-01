import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ device: vi.fn(), rpc: vi.fn(), bill: vi.fn() }));
vi.mock("@/lib/cloud-device-auth", () => ({ requireCloudDevice: mocks.device }));
vi.mock("@/lib/interest", async () => import("../../../../../lib/interest"));
vi.mock("@/lib/supabase", () => ({ createAdminSupabase: () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.bill }) }) }) }) }) }));
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

function ready(deviceId: string) {
  vi.stubEnv("BILLING_SYNC_BILL_EXPERIMENTAL", "1");
  mocks.device.mockResolvedValue({ userId: "owner-a", deviceId });
  mocks.bill.mockResolvedValue({ data: { delivery_date: null }, error: null });
}
const editOf = (initial: ReturnType<typeof example>) => ({ ...initial, action: "update", baseOperationId: randomUUID() });
const secret = "a".repeat(64);

it("separates problems worth retrying from ones a person must review", async () => {
  const operation = example(); ready(operation.deviceId);
  const statusFor = async (error: object) => { mocks.rpc.mockResolvedValueOnce({ data: null, error }); return (await POST(request(operation, secret))).status; };
  expect(await statusFor({ message: "insert or update on table bills violates foreign key constraint", code: "23503" })).toBe(422);
  expect(await statusFor({ message: "Invalid bill details", code: "P0001" })).toBe(422);
  expect(await statusFor({ message: "invalid input syntax for type uuid", code: "22P02" })).toBe(422);
  expect(await statusFor({ message: "Offline permission changed; manual review is required", code: "P0001" })).toBe(409);
  expect(await statusFor({ message: "Delivery changed; retry the edit", code: "P0001" })).toBe(503);
  expect(await statusFor({ message: "Device authentication failed", code: "P0001" })).toBe(403);
  expect(await statusFor({ message: "connection timed out", code: "57014" })).toBe(503);
  expect(await statusFor({ message: "fetch failed" })).toBe(503);
});

it("reports an outage as temporary rather than a sign-in problem", async () => {
  vi.stubEnv("BILLING_SYNC_BILL_EXPERIMENTAL", "1");
  mocks.device.mockRejectedValueOnce(new Error("Unable to verify billing access."));
  expect((await POST(request(example(), secret))).status).toBe(503);
  mocks.device.mockRejectedValueOnce(new Error("Device authentication failed."));
  expect((await POST(request(example(), secret))).status).toBe(403);
  mocks.device.mockRejectedValueOnce(new Error("This user is not approved for billing."));
  expect((await POST(request(example(), secret))).status).toBe(403);
});

it("sends a future-dated edit to review, but accepts a new bill with the server's time", async () => {
  const initial = example(); ready(initial.deviceId);
  const future = new Date(Date.now() + 86400000).toISOString();
  const refused = await POST(request({ ...editOf(initial), occurredAt: future }, secret));
  expect(refused.status).toBe(422);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ data: { operationId: initial.id, billId: initial.entityId, billNumber: 1 }, error: null });
  const accepted = await POST(request({ ...initial, occurredAt: future }, secret));
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toMatchObject({ accepted: true, clockWarning: true });
  expect(Date.parse(mocks.rpc.mock.calls[0][1].p_occurred_at)).toBeLessThan(Date.now() + 1000);
});

it("recalculates a delivered bill's summary on the server when it's edited", async () => {
  const initial = example(); ready(initial.deviceId);
  const operation = editOf(initial);
  mocks.bill.mockResolvedValue({ data: { delivery_date: "2026-12-05" }, error: null });
  mocks.rpc.mockResolvedValue({ data: { operationId: operation.id, billId: operation.entityId, outcome: "applied" }, error: null });
  expect((await POST(request(operation, secret))).status).toBe(200);
  const args = mocks.rpc.mock.calls[0][1];
  expect(args.p_delivery_date).toBe("2026-12-05");
  expect(args.p_delivery_summary).toMatchObject({ principal: 10000, missingMetal: false });
});

it("uses a corrected delivery date from the edit, and sends nothing for an undelivered bill", async () => {
  const initial = example(); ready(initial.deviceId);
  const corrected = editOf({ ...initial, payload: { ...initial.payload, deliveryNo: "7", deliveryDate: "2026-11-20" } } as ReturnType<typeof example>);
  mocks.rpc.mockResolvedValue({ data: { operationId: corrected.id, billId: corrected.entityId, outcome: "applied" }, error: null });
  await POST(request(corrected, secret));
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_delivery_date: "2026-11-20" });
  mocks.rpc.mockClear();
  const plain = editOf(initial);
  mocks.rpc.mockResolvedValue({ data: { operationId: plain.id, billId: plain.entityId, outcome: "applied" }, error: null });
  await POST(request(plain, secret));
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_delivery_date: null, p_delivery_summary: null });
});

it("preserves a concurrent edit until its newer server version is reconciled", async () => {
  vi.stubEnv("BILLING_SYNC_BILL_EXPERIMENTAL", "1");
  const initial = example(), secret = randomBytes(32).toString("hex");
  const operation = { ...initial, action: "update", baseOperationId: randomUUID() };
  mocks.device.mockResolvedValue({ userId: "owner-a", deviceId: operation.deviceId });
  mocks.bill.mockResolvedValue({ data: { delivery_date: null }, error: null });
  mocks.rpc.mockResolvedValue({ data: { operationId: operation.id, billId: operation.entityId, outcome: "superseded" }, error: null });
  const response = await POST(request(operation, secret));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ accepted: true, superseded: true });
  expect(mocks.rpc).toHaveBeenCalledWith("sync_edit_bill", expect.objectContaining({ p_owner_id: "owner-a", p_base_operation_id: operation.baseOperationId }));
  mocks.rpc.mockResolvedValueOnce({ data: { operationId: operation.id, billId: operation.entityId, outcome: "needs_review" }, error: null });
  expect((await POST(request(operation, secret))).status).toBe(409);
});
