import { afterEach, expect, it, vi } from "vitest";
import { requireUser } from "./auth";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn() }));
vi.mock("./storage-mode", () => ({ localStorageEnabled: false }));
vi.mock("./supabase", () => ({ createAdminSupabase: () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

it("accepts only an enabled approval for the authenticated cloud user", async () => {
  vi.stubEnv("BILLING_CLOUD_MULTIUSER", "1");
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-a", email: "owner@example.test" } }, error: null });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { user_id: "owner-a", enabled: true }, error: null }) };
  mocks.from.mockReturnValue(query);
  const request = new Request("https://billing.example.test/api/profile", { headers: { authorization: "Bearer test-token" } });
  await expect(requireUser(request)).resolves.toMatchObject({ id: "owner-a" });
  expect(mocks.getUser).toHaveBeenCalledWith("test-token");
  expect(mocks.from).toHaveBeenCalledWith("billing_user_access");
  expect(query.eq).toHaveBeenCalledWith("user_id", "owner-a");
  query.maybeSingle.mockResolvedValueOnce({ data: { user_id: "owner-a", enabled: false }, error: null });
  await expect(requireUser(request)).rejects.toThrow(/not approved/);
  query.maybeSingle.mockResolvedValueOnce({ data: { user_id: "owner-b", enabled: true }, error: null });
  await expect(requireUser(request)).rejects.toThrow(/not approved/);
  query.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error("database offline") });
  await expect(requireUser(request)).rejects.toThrow(/Unable to verify billing access/);
});

it("rejects an invalid cloud session before accessing approval records", async () => {
  vi.stubEnv("BILLING_CLOUD_MULTIUSER", "1");
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid") });
  const request = new Request("https://billing.example.test/api/profile", { headers: { authorization: "Bearer invalid" } });
  await expect(requireUser(request)).rejects.toThrow(/session has expired/);
  expect(mocks.from).not.toHaveBeenCalled();
});
