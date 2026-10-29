import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "./route";

const mocks = vi.hoisted(() => ({ user: vi.fn(), profile: vi.fn(), single: vi.fn(), remove: vi.fn(), rpc: vi.fn(), versions: vi.fn(), sync: vi.fn(), query: { select: vi.fn(), eq: vi.fn(), single: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.user, requireOwnerProfile: mocks.profile }));
vi.mock("@/lib/accounts", async () => import("../../../../lib/accounts"));
vi.mock("@/lib/storage-mode", () => ({ localStorageEnabled: true }));
vi.mock("@/lib/supabase", () => ({ createAdminSupabase: () => ({ from: () => mocks.query, rpc: mocks.rpc, storage: { from: () => ({ remove: mocks.remove }) } }) }));
vi.mock("@/lib/validation", async () => import("../../../../lib/validation"));
vi.mock("@/lib/bills", async () => import("../../../../lib/bills"));
vi.mock("@/lib/bill-update-outputs", () => ({ refreshUpdatedBillOutputs: vi.fn() }));
vi.mock("@/lib/register-sync", () => ({ syncAccountRegister: mocks.sync }));
vi.mock("@/lib/local-bill-pdfs", () => ({ localBillPdfPaths: mocks.versions }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "owner" }); mocks.profile.mockResolvedValue({ id: "profile" });
  mocks.query.select.mockReturnValue(mocks.query); mocks.query.eq.mockReturnValue(mocks.query); mocks.query.single.mockImplementation(mocks.single);
  mocks.single.mockResolvedValue({ data: { id: "bill", pdf_storage_path: "profile/current.pdf", delivery_pdf_storage_path: "profile/delivery.pdf" }, error: null });
  mocks.versions.mockResolvedValue(["profile/original.pdf", "profile/old-version.pdf", "profile/current.pdf"]);
  mocks.remove.mockResolvedValue({ error: null }); mocks.rpc.mockResolvedValue({ data: { nextBillNumber: 1 }, error: null }); mocks.sync.mockResolvedValue(undefined);
});

const request = () => new Request("http://localhost:3101/api/bills/bill?account=6", { method: "DELETE" });
const context = () => ({ params: Promise.resolve({ id: "bill" }) });

describe("permanent local bill deletion", () => {
  it("removes cached PDF versions and both current documents before clearing the register", async () => {
    const response = await DELETE(request(), context());
    expect(response.status).toBe(200);
    expect(mocks.profile).toHaveBeenCalledWith("owner", 6);
    expect(mocks.versions).toHaveBeenCalledWith("profile", "bill");
    expect(mocks.remove).toHaveBeenCalledWith(["profile/current.pdf", "profile/delivery.pdf", "profile/original.pdf", "profile/old-version.pdf"]);
    expect(mocks.rpc).toHaveBeenCalledWith("delete_bill", { p_owner_id: "owner", p_bill_id: "bill" });
    expect(mocks.sync).toHaveBeenCalledWith("profile");
    expect(await response.json()).toMatchObject({ ok: true, nextBillNumber: 1, registerSyncStatus: "synced" });
  });
  it("does not scan or remove anything for a bill outside the selected account", async () => {
    mocks.single.mockResolvedValue({ data: null, error: new Error("Not found") });
    expect((await DELETE(request(), context())).status).toBe(400);
    expect(mocks.versions).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
