import { afterEach, describe, expect, it, vi } from "vitest";
import { requireOwnerProfile } from "./auth";
import { createAdminSupabase } from "./supabase";

const mode = vi.hoisted(() => ({ local: true }));
vi.mock("./storage-mode", () => ({ get localStorageEnabled() { return mode.local; } }));
vi.mock("./supabase", () => ({ createAdminSupabase: vi.fn() }));
afterEach(() => { mode.local = true; vi.clearAllMocks(); });

describe("business profile account access", () => {
  it("looks up added local accounts with both owner and slot filters", async () => {
    const result = { data: { id: "new-profile", account_slot: 4 }, error: null };
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(result) };
    vi.mocked(createAdminSupabase).mockReturnValue({ from: vi.fn().mockReturnValue(query) } as unknown as ReturnType<typeof createAdminSupabase>);
    await expect(requireOwnerProfile("local-owner", 4)).resolves.toEqual(result.data);
    expect(query.eq.mock.calls).toEqual([["owner_id", "local-owner"], ["account_slot", 4]]);
  });

  it("rejects invalid IDs before accessing a database", async () => {
    for (const account of [0, -1, 1.5, NaN, Infinity, 2_147_483_647]) await expect(requireOwnerProfile("local-owner", account)).rejects.toThrow("Choose a valid business account");
    expect(createAdminSupabase).not.toHaveBeenCalled();
  });

  it("retains the existing cloud limit", async () => {
    mode.local = false;
    await expect(requireOwnerProfile("owner", 4)).rejects.toThrow("Choose a valid business account");
    expect(createAdminSupabase).not.toHaveBeenCalled();
  });
});
