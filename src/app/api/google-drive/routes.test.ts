import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), profile: vi.fn(), db: vi.fn(), begin: vi.fn(), read: vi.fn(), exchange: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.user, requireOwnerProfile: mocks.profile }));
vi.mock("@/lib/accounts", () => ({ accountSlot: (request: Request) => Number(new URL(request.url).searchParams.get("account") || 1) }));
vi.mock("@/lib/supabase", () => ({ createAdminSupabase: mocks.db }));
vi.mock("@/lib/crypto", () => ({ encrypt: () => "encrypted" }));
vi.mock("@/lib/google-oauth", () => ({ beginGoogleConnection: mocks.begin, googleConfigured: () => true, googleCookie: "oauth", readGoogleConnection: mocks.read, exchangeGoogleCode: mocks.exchange, applicationUrl: (origin: string) => origin, driveWorkbookName: (slot: number) => `Account ${slot}.xlsx` }));
import { GET as status, POST as connect } from "./connect/route";
import { GET as callback } from "./callback/route";
let filters: Record<string, unknown>;
let upsert: ReturnType<typeof vi.fn>;
let result: { data: Record<string, unknown> | null; error: null };
beforeEach(() => {
  vi.clearAllMocks(); filters = {};
  result = { data: { id: "profile-two", business_name: "Business two" }, error: null };
  const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn((key: string, value: unknown) => { filters[key] = value; return chain; }), maybeSingle: vi.fn(async () => result) };
  upsert = vi.fn(async () => ({ error: null }));
  mocks.db.mockReturnValue({ from: () => ({ ...chain, upsert }) });
  mocks.user.mockResolvedValue({ id: "owner" });
  mocks.profile.mockResolvedValue({ id: "profile-two" });
  mocks.begin.mockReturnValue({ url: "https://accounts.google.com", cookie: "encrypted" });
  mocks.read.mockReturnValue({ ownerId: "owner", profileId: "profile-two", accountSlot: 2 });
  mocks.exchange.mockResolvedValue("refresh");
});
it("reads connection status and begins OAuth for the selected account", async () => {
  const request = new Request("https://billing.test/api/google-drive/connect?account=2");
  await status(request); expect(mocks.profile).toHaveBeenCalledWith("owner", 2);
  expect(filters.profile_id).toBe("profile-two");
  await connect(request); expect(mocks.begin).toHaveBeenCalledWith("owner", "https://billing.test", "profile-two", 2);
});
it("verifies all callback account bindings and redirects back to that account", async () => {
  const response = await callback(new Request("https://billing.test/api/google-drive/callback?code=code&state=state"));
  expect(filters).toEqual({ owner_id: "owner", id: "profile-two", account_slot: 2 });
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ profile_id: "profile-two", workbook_name: "Account 2.xlsx" }), { onConflict: "profile_id" });
  expect(response.headers.get("location")).toContain("account=2&google-drive=connected");
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
});
it("rejects a deleted or reassigned profile before exchanging credentials", async () => {
  result.data = null;
  const response = await callback(new Request("https://billing.test/api/google-drive/callback?code=code&state=state"));
  expect(mocks.exchange).not.toHaveBeenCalled(); expect(upsert).not.toHaveBeenCalled();
  expect(response.headers.get("location")).toContain("google-drive=error");
});
