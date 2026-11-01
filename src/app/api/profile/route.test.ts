import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ local: true, cloud: false, rpc: vi.fn(), requireUser: vi.fn(), accountSlot: vi.fn() }));
vi.mock("@/lib/storage-mode", () => ({ get localStorageEnabled() { return mocks.local; } }));
vi.mock("@/lib/cloud-mode", () => ({ cloudMultiUserEnabled: () => mocks.cloud }));
vi.mock("@/lib/supabase", () => ({ createAdminSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/accounts", () => ({ accountSlot: mocks.accountSlot }));
vi.mock("@/lib/profile-validation", async () => import("../../../lib/profile-validation"));
afterEach(() => { mocks.local = true; mocks.cloud = false; vi.resetAllMocks(); });

it("saves a cloud profile for the authenticated owner and selected account", async () => {
  mocks.local = false; mocks.cloud = true;
  mocks.requireUser.mockResolvedValue({ id: "approved-owner" }); mocks.accountSlot.mockReturnValue(4);
  mocks.rpc.mockResolvedValue({ data: { id: "profile", account_slot: 4 }, error: null });
  const request = new Request("http://localhost/api/profile?account=4", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessName: "Test Finance", address: "123 Main Street", phone: "1234567890", licenseNumber: "LIC-4", ownerId: "other-owner" }) });
  expect((await POST(request)).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("save_cloud_business_profile", { p_owner_id: "approved-owner", p_profile: { businessName: "Test Finance", address: "123 Main Street", phone: "1234567890", licenseNumber: "LIC-4", accountSlot: 4 } });
});

it("does not save any profile when authentication fails", async () => {
  mocks.local = false; mocks.cloud = true; mocks.requireUser.mockRejectedValue(new Error("Not approved"));
  const request = new Request("http://localhost/api/profile", { method: "POST", body: "{}" });
  expect((await POST(request)).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
