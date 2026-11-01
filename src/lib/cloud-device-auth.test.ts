import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { requireCloudDevice } from "./cloud-device-auth";

const mocks = vi.hoisted(() => ({ local: false, cloud: true, user: vi.fn(), rpc: vi.fn() }));
vi.mock("./storage-mode", () => ({ get localStorageEnabled() { return mocks.local; } }));
vi.mock("./cloud-mode", () => ({ cloudMultiUserEnabled: () => mocks.cloud }));
vi.mock("./auth", () => ({ requireUser: mocks.user }));
vi.mock("./supabase", () => ({ createAdminSupabase: () => ({ rpc: mocks.rpc }) }));
afterEach(() => { mocks.local = false; mocks.cloud = true; vi.resetAllMocks(); });

it("verifies the signed-in owner and a hashed device secret without returning the secret", async () => {
  const id = randomUUID(), secret = randomBytes(32).toString("hex");
  mocks.user.mockResolvedValue({ id: "owner-a" }); mocks.rpc.mockResolvedValue({ data: true, error: null });
  const request = new Request("https://billing.example.test/api/cloud/sync", { headers: { "x-billing-device-id": id, "x-billing-device-secret": secret, "x-owner-id": "owner-b" } });
  expect(await requireCloudDevice(request)).toEqual({ userId: "owner-a", deviceId: id });
  expect(mocks.rpc).toHaveBeenCalledWith("verify_cloud_device", { p_owner_id: "owner-a", p_device_id: id, p_token_hash: createHash("sha256").update(secret).digest("hex") });
});

it("rejects missing credentials, a different secret or database failure", async () => {
  mocks.user.mockResolvedValue({ id: "owner-a" });
  await expect(requireCloudDevice(new Request("https://billing.example.test/api/cloud/sync"))).rejects.toThrow(/authentication failed/);
  expect(mocks.rpc).not.toHaveBeenCalled();
  const request = new Request("https://billing.example.test/api/cloud/sync", { headers: { "x-billing-device-id": randomUUID(), "x-billing-device-secret": randomBytes(32).toString("hex") } });
  mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
  await expect(requireCloudDevice(request)).rejects.toThrow(/authentication failed/);
  mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("database offline") });
  await expect(requireCloudDevice(request)).rejects.toThrow(/authentication failed/);
});
