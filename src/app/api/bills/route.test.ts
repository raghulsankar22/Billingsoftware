import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ local: false, cloud: true, requireUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/storage-mode", () => ({ get localStorageEnabled() { return mocks.local; } }));
vi.mock("@/lib/cloud-mode", () => ({ cloudMultiUserEnabled: () => mocks.cloud, legacyIssuanceBlocked: (local: boolean) => !local && mocks.cloud }));
vi.mock("@/lib/accounts", () => ({ accountSlot: () => 1 }));
vi.mock("@/lib/validation", () => ({ billSchema: { parse: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser, requireOwnerProfile: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createAdminSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/bills", () => ({ toBill: vi.fn(), totals: vi.fn() }));
vi.mock("@/lib/register-sync", () => ({ syncBillToRegister: vi.fn() }));
vi.mock("@/lib/bill-pdf-storage", () => ({ persistBillPdf: vi.fn() }));
vi.mock("@/lib/bill-history", () => ({ loadBillHistory: vi.fn() }));
afterEach(() => { mocks.local = false; mocks.cloud = true; vi.resetAllMocks(); });

it("prevents the unfinished cloud mode from creating incomplete or unsynchronized bills", async () => {
  const request = new Request("http://localhost/api/bills", { method: "POST", body: "{}" });
  const response = await POST(request);
  expect(response.status).toBe(503);
  expect(mocks.requireUser).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
