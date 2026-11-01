import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { createLocalDatabase, localOwnerId } from "../../../../../lib/local-database";
import { createCloudSyncClient } from "../../../../../lib/cloud-sync-client";
import { flushSyncBatch } from "../../../../../lib/sync-flush";
import { createSyncOutbox } from "../../../../../lib/sync-outbox";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ device: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/cloud-device-auth", () => ({ requireCloudDevice: mocks.device }));
vi.mock("@/lib/interest", async () => import("../../../../../lib/interest"));
vi.mock("@/lib/supabase", () => ({ createAdminSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/sync-bill", async () => import("../../../../../lib/sync-bill"));
vi.mock("@/lib/sync-outbox", async () => import("../../../../../lib/sync-outbox"));
vi.mock("@/lib/sync-conflicts", async () => import("../../../../../lib/sync-conflicts"));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

it("queues an offline bill atomically and retries a lost confirmation without issuing twice", async () => {
  vi.stubEnv("BILLING_SYNC_BILL_EXPERIMENTAL", "1");
  const directory = mkdtempSync(join(tmpdir(), "billing-sync-flow-"));
  const local = createLocalDatabase(directory); let queueDb: DatabaseSync | undefined;
  try {
    const profile = await local.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { accountSlot: 1, businessName: "Test Finance", address: "Test Road 1", phone: "1234567890" } });
    expect(profile.error).toBeNull();
    const deviceId = randomUUID(), secret = randomBytes(32).toString("hex"), operationId = randomUUID();
    local.sync.saveAssignment(profile.data.id, deviceId, 1, { nextBillNumber: 1, nextDeliveryNumber: 1 });
    const issued = await local.rpc("create_bill_with_sync", { p_owner_id: localOwnerId, p_device_id: deviceId, p_issuer_epoch: 1, p_operation_id: operationId,
      p_bill: { accountSlot: 1, billDate: "2026-11-01", customerName: "Test Customer", fatherName: "Test Parent", address: "Test Address", phone: "", items: [{ metal: "Gold", particulars: "Ring 1", grams: 1, loanAmount: 10000, assessedValue: 11000 }] } });
    expect(issued.error).toBeNull();
    queueDb = new DatabaseSync(join(directory, "billing.sqlite"));
    const outbox = createSyncOutbox(queueDb), saved = new Map<string, { billId: string; hash: string }>();
    mocks.device.mockImplementation(async (request: Request) => {
      if (request.headers.get("x-billing-device-id") !== deviceId || request.headers.get("x-billing-device-secret") !== secret || request.headers.get("authorization") !== "Bearer test-token") throw new Error("Authentication failed");
      return { userId: "cloud-owner", deviceId };
    });
    mocks.rpc.mockImplementation(async (_name: string, args: Record<string, string | number>) => {
      const existing = saved.get(String(args.p_operation_id));
      if (existing && existing.hash !== args.p_operation_hash) return { data: null, error: { message: "Sync operation does not match its receipt" } };
      if (!existing) saved.set(String(args.p_operation_id), { billId: String(args.p_bill_id), hash: String(args.p_operation_hash) });
      return { data: { operationId: args.p_operation_id, billId: args.p_bill_id, billNumber: args.p_bill_number }, error: null };
    });
    let firstReplyLost = true;
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      const response = await POST(new Request(url, init));
      if (firstReplyLost) { firstReplyLost = false; throw new Error("Simulated lost response"); }
      return response;
    };
    const client = createCloudSyncClient({ baseUrl: "https://billing.example.test", accessToken: "test-token", deviceId, deviceSecret: secret, fetcher: fetcher as typeof fetch });
    await expect(flushSyncBatch(outbox, client, profile.data.id)).rejects.toThrow(/Changes remain/);
    expect(outbox.pending(profile.data.id)).toHaveLength(1);
    expect(await flushSyncBatch(outbox, client, profile.data.id)).toMatchObject({ sent: 1, hasMore: false });
    expect(saved.size).toBe(1);
    expect(saved.get(operationId)?.billId).toBe(issued.data.id);
    expect(outbox.pending(profile.data.id)).toHaveLength(0);
  } finally { queueDb?.close(); local.close(); rmSync(directory, { recursive: true, force: true }); }
});
