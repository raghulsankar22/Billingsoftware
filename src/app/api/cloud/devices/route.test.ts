import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ local: false, cloud: true, requireUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/storage-mode", () => ({ get localStorageEnabled() { return mocks.local; } }));
vi.mock("@/lib/cloud-mode", () => ({ cloudMultiUserEnabled: () => mocks.cloud }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase", () => ({ createAdminSupabase: () => ({ rpc: mocks.rpc }) }));
afterEach(() => { mocks.local = false; mocks.cloud = true; vi.resetAllMocks(); });

const request = (body: unknown) => new Request("https://billing.example.test/api/cloud/devices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

it("binds a device to the authenticated user, stores only its hash and never echoes its secret", async () => {
  mocks.requireUser.mockResolvedValue({ id: "approved-owner" });
  mocks.rpc.mockResolvedValue({ data: { id: "device", name: "Office" }, error: null });
  const deviceId = randomUUID(), secret = randomBytes(32).toString("hex");
  const response = await POST(request({ name: " Office ", deviceId, secret }));
  const result = await response.json();
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(result.secret).toBeUndefined();
  const [name, args] = mocks.rpc.mock.calls[0];
  expect(name).toBe("register_cloud_device");
  expect(args).toMatchObject({ p_owner_id: "approved-owner", p_name: "Office", p_device_id: deviceId, p_token_hash: createHash("sha256").update(secret).digest("hex") });
  expect(JSON.stringify(result.device)).not.toContain(args.p_token_hash);
  expect(JSON.stringify(result)).not.toContain(secret);
});

it("rejects owner spoofing and unapproved sessions before saving a device", async () => {
  mocks.requireUser.mockResolvedValue({ id: "approved-owner" });
  const deviceId = randomUUID(), secret = randomBytes(32).toString("hex");
  expect((await POST(request({ name: "Office", deviceId, secret, ownerId: "someone-else" }))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.requireUser.mockRejectedValue(new Error("Not approved"));
  expect((await POST(request({ name: "Office", deviceId, secret }))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("is unavailable outside the unfinished cloud mode", async () => {
  mocks.cloud = false;
  expect((await POST(request({ name: "Office" }))).status).toBe(404);
  expect(mocks.requireUser).not.toHaveBeenCalled();
});
