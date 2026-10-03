import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { loadBillHistory } from "./bill-history";

function database(total = 1, serverLimit = 500) {
  const requests: URL[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 500), serverLimit);
    const length = Math.max(0, Math.min(limit, total - offset));
    const rows = Array.from({ length }, (_, index) => ({
      id: `bill-${offset + index}`, bill_number: total - offset - index,
      customer_name: "Customer", bill_date: "2026-10-03", bill_items: [],
    }));
    return new Response(JSON.stringify(rows), { headers: {
      "content-type": "application/json", "content-range": `${offset}-${offset + length - 1}/${total}`,
    } });
  });
  const client = createClient("https://example.supabase.co", "test-key", { global: { fetch } });
  return { client, requests, fetch };
}

describe("bill history queries", () => {
  it("loads the complete history beyond 100 and hosted API row limits", async () => {
    const { client, requests } = database(1205, 100);
    const result = await loadBillHistory(client, "owner-profile", new URLSearchParams());
    expect(result.bills).toHaveLength(1205);
    expect(result.total).toBe(1205);
    expect(result.hasMore).toBe(false);
    expect(requests).toHaveLength(13);
    for (const url of requests) {
      expect(url.searchParams.get("profile_id")).toBe("eq.owner-profile");
      expect(url.searchParams.get("order")).toBe("bill_number.desc,id.desc");
    }
  });

  it("returns a requested page and its total", async () => {
    const { client, requests } = database(225);
    const result = await loadBillHistory(client, "owner-profile", new URLSearchParams("page=3&pageSize=50"));
    expect(result.bills).toHaveLength(50);
    expect(result.bills[0].billNumber).toBe(125);
    expect(result).toMatchObject({ total: 225, page: 3, pageSize: 50, hasMore: true });
    expect(requests[0].searchParams.get("offset")).toBe("100");
  });

  it("fills pages when the hosted API row limit is lower than pageSize", async () => {
    const { client, requests } = database(1200, 100);
    const result = await loadBillHistory(client, "owner", new URLSearchParams("page=2&pageSize=500"));
    expect(result.bills).toHaveLength(500);
    expect(result.bills[0].billNumber).toBe(700);
    expect(result.bills[499].billNumber).toBe(201);
    expect(result.hasMore).toBe(true);
    expect(requests).toHaveLength(5);
  });

  it.each(["42", "#42"])("searches bill number, customer, and mobile for %s", async (search) => {
    const { client, requests } = database();
    await loadBillHistory(client, "owner", new URLSearchParams({ q: search }));
    expect(requests[0].searchParams.get("or")).toContain("bill_number.eq.42");
    expect(requests[0].searchParams.get("or")).toContain("customer_name.imatch.");
    expect(requests[0].searchParams.get("or")).toContain("phone.imatch.");
  });

  it.each(["2026-10-03", "03/10/2026", "03-10-2026"])("searches dates entered as %s", async (search) => {
    const { client, requests } = database();
    await loadBillHistory(client, "owner", new URLSearchParams({ q: search, from: "01/10/2026", to: "2026-10-31" }));
    expect(requests[0].searchParams.get("or")).toContain("bill_date.eq.2026-10-03");
    expect(requests[0].searchParams.get("bill_date")).toBe("gte.2026-10-01");
    expect(requests[0].searchParams.getAll("bill_date")).toEqual(["gte.2026-10-01", "lte.2026-10-31"]);
  });

  it("quotes punctuation so it cannot inject additional PostgREST filters", async () => {
    const { client, requests } = database();
    await loadBillHistory(client, "owner", new URLSearchParams({ q: 'A,B).id.neq.0,"x\\%_' }));
    const filters = requests[0].searchParams.get("or")!;
    expect(filters).toContain('customer_name.imatch."A,B');
    expect(filters).toContain('\\"x');
    expect(filters).not.toContain("bill_number.eq");
    expect(requests[0].searchParams.get("profile_id")).toBe("eq.owner");
  });

  it("treats regex and LIKE metacharacters as literal search text", async () => {
    const { client, requests } = database();
    const search = "A.*[B](C)%_";
    await loadBillHistory(client, "owner", new URLSearchParams({ q: search }));
    const filters = requests[0].searchParams.get("or")!;
    const quotedPattern = filters.slice("(customer_name.imatch.".length, filters.indexOf(",phone.imatch."));
    const pattern = JSON.parse(quotedPattern) as string;
    const regex = new RegExp(pattern, "i");
    expect(regex.test(`Customer ${search}`)).toBe(true);
    expect(regex.test("AXYZBCXX")).toBe(false);
  });

  it("applies an exact bill date filter", async () => {
    const { client, requests } = database();
    await loadBillHistory(client, "owner", new URLSearchParams("date=03%2F10%2F2026"));
    expect(requests[0].searchParams.get("bill_date")).toBe("eq.2026-10-03");
  });

  it("returns an empty history without requesting additional batches", async () => {
    const { client, requests } = database(0);
    expect(await loadBillHistory(client, "owner", new URLSearchParams())).toMatchObject({ bills: [], total: 0, hasMore: false });
    expect(requests).toHaveLength(1);
  });

  it("reports database errors instead of returning partial history", async () => {
    const { client, fetch } = database(600);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 500 }, (_, id) => ({ id, bill_number: id }))), {
      headers: { "content-type": "application/json", "content-range": "0-499/600" },
    }));
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: "Database query failed" }), { status: 400 }));
    await expect(loadBillHistory(client, "owner", new URLSearchParams())).rejects.toThrow("Database query failed");
  });

  it.each(["date=2026-02-30", "from=bad", "from=2026-10-03&to=2026-10-01", "page=-1", "page=1.5", "pageSize=501"])("rejects invalid query %s before database access", async (query) => {
    const { client, fetch } = database();
    await expect(loadBillHistory(client, "owner", new URLSearchParams(query))).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
