import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ local: false, cloud: true, requireUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/storage-mode", () => ({ get localStorageEnabled() { return mocks.local; } }));
vi.mock("@/lib/cloud-mode", () => ({ legacyIssuanceBlocked: (local: boolean) => !local && mocks.cloud }));
vi.mock("@/lib/accounts", () => ({ accountSlot: () => 1 }));
vi.mock("@/lib/validation", () => ({ billSchema: { parse: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser, requireOwnerProfile: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createAdminSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/bills", () => ({ toBill: vi.fn(), totals: vi.fn() }));
vi.mock("@/lib/register-sync", () => ({ markBillVoidInRegister: vi.fn(), syncBillToRegister: vi.fn() }));
vi.mock("@/lib/bill-pdf-storage", () => ({ persistBillPdf: vi.fn() }));
afterEach(() => { mocks.local = false; mocks.cloud = true; vi.resetAllMocks(); });

const send = () => POST(new Request("http://localhost/api/bills/1/replace", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "1" }) });

it("can't issue a bill through replacement in the unfinished cloud mode", async () => {
  const response = await send();
  expect(response.status).toBe(503);
  expect(mocks.requireUser).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("keeps replacement available outside that mode", async () => {
  mocks.cloud = false;
  mocks.requireUser.mockRejectedValue(new Error("Sign in is required."));
  expect((await send()).status).toBe(400);
  expect(mocks.requireUser).toHaveBeenCalled();
});
