import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDatabase, localOwnerId } from "../../../lib/local-database";
import { GET, PATCH, POST } from "./route";

const mocks = vi.hoisted(() => ({ local: true, requireUser: vi.fn(), directory: "" }));
vi.mock("@/lib/storage-mode", () => ({ get localStorageEnabled() { return mocks.local; } }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/accounts", async () => import("../../../lib/accounts"));
vi.mock("@/lib/local-database", async () => {
  const actual = await import("../../../lib/local-database");
  return { ...actual, createLocalDatabase: () => actual.createLocalDatabase(mocks.directory) };
});

const details = { name: "Test Customer", fatherName: "Test Parent", address: "123 Test Street", phone: "9876543210", aadhaar: "123456789012" };
const request = (method = "GET", query = "account=1", body?: unknown) => new Request(`http://localhost:3100/api/customers?${query}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
let db: ReturnType<typeof createLocalDatabase>;
beforeEach(async () => {
  mocks.directory = mkdtempSync(join(tmpdir(), "billing-customer-api-"));
  db = createLocalDatabase(mocks.directory);
  mocks.requireUser.mockResolvedValue({ id: localOwnerId });
  for (const accountSlot of [1, 2]) {
    const result = await db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { businessName: "Finance", address: "123 Business Street", phone: "1234567890", accountSlot } });
    expect(result.error).toBeNull();
  }
});
afterEach(() => { db.close(); rmSync(mocks.directory, { recursive: true, force: true }); mocks.local = true; vi.resetAllMocks(); });

describe("customer API", () => {
  it("assigns canonical codes, shares them across accounts and ignores client codes", async () => {
    const response = await POST(request("POST", "account=1", { ...details, customerCode: "C999999" }));
    const { customer } = await response.json();
    expect(customer.customerCode).toBe("C000001");
    expect(await (await GET(request("GET", "account=1&q=c000001"))).json()).toEqual({ customers: [customer] });
    expect(await (await GET(request("GET", "account=2&q=C000001"))).json()).toEqual({ customers: [customer] });
    const updated = await PATCH(request("PATCH", "account=1", { ...customer, customerCode: "C999999", name: "Changed" }));
    expect((await updated.json()).customer).toMatchObject({ id: customer.id, customerCode: "C000001" });
    expect((await (await POST(request("POST", "account=2", details))).json()).customer.customerCode).toBe("C000001");
  });
  it("creates, searches, looks up normalized exact identifiers and edits without caching personal details", async () => {
    const created = await POST(request("POST", "account=1", { ...details, phone: "+91 98765 43210" }));
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const { customer } = await created.json();
    expect(customer).toMatchObject({ ...details, customerCode: "C000001" });
    expect(await (await GET(request("GET", "account=1&q=TEST%20CUSTOMER"))).json()).toEqual({ customers: [customer] });
    for (const query of ["phone=%2B91%2098765%2043210", "aadhaar=1234-5678-9012", "phone=9876543210&aadhaar=123456789012"]) {
      const response = await GET(request("GET", `account=1&${query}`));
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ customer });
    }
    const updated = await PATCH(request("PATCH", "account=1", { ...customer, name: "Changed Customer", phone: "", aadhaar: "" }));
    expect(updated.status).toBe(200);
    expect(updated.headers.get("cache-control")).toBe("no-store");
    expect((await updated.json()).customer).toMatchObject({ id: customer.id, customerCode: customer.customerCode, name: "Changed Customer", phone: "", aadhaar: "" });
    expect(await (await GET(request("GET", "account=1&phone=9876543210"))).json()).toEqual({ customer: null });
    expect(mocks.requireUser).toHaveBeenCalledTimes(7);
  });
  it("rejects origin/authentication failures, foreign owners and cloud access before opening customer records", async () => {
    mocks.requireUser.mockRejectedValue(new Error("Open billing directly on this computer."));
    for (const handler of [GET, POST, PATCH]) {
      const response = await handler(request(handler === GET ? "GET" : handler === POST ? "POST" : "PATCH", "account=1", handler === GET ? undefined : details));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "Open billing directly on this computer." });
    }
    mocks.requireUser.mockResolvedValue({ id: "foreign-owner" });
    expect((await GET(request())).status).toBe(400);
    mocks.local = false;
    const cloud = await POST(request("POST", "account=1", details));
    expect(cloud.status).toBe(400);
    expect(await cloud.json()).toEqual({ error: "Customers are available in offline billing." });
    expect(db.customers.list(1)).toEqual([]);
  });
  it("shares customers and edits while rejecting missing profiles and invalid accounts", async () => {
    const saved = db.customers.save(1, details);
    expect(await (await GET(request("GET", "account=2"))).json()).toEqual({ customers: [saved] });
    expect(await (await GET(request("GET", "account=2&phone=9876543210"))).json()).toEqual({ customer: saved });
    expect((await PATCH(request("PATCH", "account=2", { ...details, id: saved.id }))).status).toBe(200);
    for (const account of ["0", "-1", "1.2", "01", "2147483647", "invalid", "4"]) {
      expect((await POST(request("POST", `account=${account}`, details))).status).toBe(400);
    }
    expect(db.customers.list(1)).toMatchObject([{ id: saved.id }]);
  });
  it("reuses duplicate or incomplete writes, invalid lookup and conflicting identifiers", async () => {
    const saved = db.customers.save(1, details);
    expect((await POST(request("POST", "account=1", details))).status).toBe(201);
    expect((await POST(request("POST", "account=1", { name: "Incomplete" }))).status).toBe(400);
    expect((await PATCH(request("PATCH", "account=1", details))).status).toBe(400);
    expect((await GET(request("GET", "account=1&phone=98765"))).status).toBe(400);
    expect((await GET(request("GET", "account=1&phone=9876543210&aadhaar=999999999999"))).status).toBe(400);
    const malformed = new Request("http://localhost:3100/api/customers?account=1", { method: "POST", body: "{" });
    expect((await POST(malformed)).status).toBe(400);
    expect(db.customers.list(1)).toEqual([saved]);
  });
});
