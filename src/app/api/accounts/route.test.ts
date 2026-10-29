import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ local: true, rpc: vi.fn(), requireUser: vi.fn() }));
vi.mock("@/lib/storage-mode", () => ({ get localStorageEnabled() { return mocks.local; } }));
vi.mock("@/lib/supabase", () => ({ createAdminSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/profile-validation", async () => import("../../../lib/profile-validation"));
afterEach(() => { mocks.local = true; vi.resetAllMocks(); });

const details = { businessName: "Fourth Finance", address: "123 Main Street", phone: "1234567890", licenseNumber: "LICENSE/4" };
const request = (body: unknown = details) => new Request("http://localhost:3115/api/accounts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("create business account endpoint", () => {
  it("authenticates and returns the allocated profile with complete validated details", async () => {
    mocks.requireUser.mockResolvedValue({ id: "local-owner" });
    mocks.rpc.mockResolvedValue({ data: { id: "fourth-profile", account_slot: 4 }, error: null });
    const response = await POST(request({ ...details, businessName: " Fourth Finance ", accountSlot: 1 }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ profile: { id: "fourth-profile", account_slot: 4 } });
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("create_business_account", { p_owner_id: "local-owner", p_profile: details });
  });

  it("does not write when the origin/authentication guard rejects the request", async () => {
    mocks.requireUser.mockRejectedValue(new Error("Open billing directly on this computer."));
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Open billing directly on this computer." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires full details before allocating an account", async () => {
    mocks.requireUser.mockResolvedValue({ id: "local-owner" });
    expect((await POST(request({ businessName: "Fourth Finance" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects creation in cloud mode without calling a cloud RPC", async () => {
    mocks.local = false;
    mocks.requireUser.mockResolvedValue({ id: "cloud-owner" });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Adding business accounts is available only in local billing." });
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
