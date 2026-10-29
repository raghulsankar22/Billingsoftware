import { describe, expect, it } from "vitest";
import type { Bill, BillItemInput } from "./types";
import { jewelStock, stockQuantity } from "./jewel-stock";

function item(particulars: string, patch: Partial<BillItemInput> = {}): BillItemInput {
  return { metal: "Gold", particulars, grams: 1, assessedValue: 12.34, loanAmount: 10.01, ...patch };
}

function bill(id: string, patch: Partial<Bill> = {}): Bill {
  return {
    id,
    billNumber: 1,
    billDate: "2026-01-01",
    status: "issued",
    customerName: "Test Customer",
    fatherName: "Test Parent",
    address: "123 Test Street",
    phone: "1234567890",
    items: [],
    totalAssessedValue: 0,
    totalLoanAmount: 0,
    amountInWords: "Zero",
    excelSyncStatus: "synced",
    createdAt: "2026-01-01T00:00:00Z",
    ...patch,
  };
}

describe("jewel stock quantity parsing", () => {
  it("sums explicit trailing quantities in comma-separated entries", () => {
    expect(stockQuantity("Ring 2, Studs 1")).toBe(3);
    expect(stockQuantity("Haram 1")).toBe(1);
    expect(stockQuantity("22K Ring 2, Style 2 Chain 1")).toBe(3);
  });

  it.each([
    "",
    "Ring",
    "Ring 0",
    "Ring -1",
    "Ring 1.5",
    "Ring 10000",
    "Ring 2, Studs",
    "Ring 2,",
    ", Ring 2",
    "Ring 2, Studs 0",
  ])("returns unknown for missing or invalid quantities in %s", particulars => {
    expect(stockQuantity(particulars)).toBeNull();
  });

  it("accepts the per-entry maximum but never exceeds it", () => {
    expect(stockQuantity("Ring 9999")).toBe(9999);
    expect(stockQuantity("Ring 9999, Studs 1")).toBe(10000);
  });
});

describe("jewel stock aggregation", () => {
  it("includes all undelivered dates and voided bills, and excludes complete deliveries", () => {
    const old = bill("old", {
      billDate: "2010-01-01",
      items: [item("Ring 2", { loanAmount: 100, assessedValue: 120, grams: 2 })],
    });
    const newest = bill("newest", {
      billDate: "2099-12-31",
      status: "void",
      items: [item("Haram 1", { loanAmount: 25, assessedValue: 30, grams: 3 })],
    });
    const delivered = bill("delivered", {
      deliveryNo: " 14 ",
      deliveryDate: " 2026-01-02 ",
      items: [item("Ring 4", { loanAmount: 999, assessedValue: 999, grams: 99 })],
    });
    const deliveredVoid = bill("delivered-void", {
      status: "void",
      deliveryNo: "15",
      deliveryDate: "2026-01-03",
      items: [item("Studs 3")],
    });

    expect(jewelStock([delivered, newest, deliveredVoid, old])).toMatchObject({
      billCount: 2,
      pledgeRows: 2,
      knownPieces: 3,
      unknownQuantityRows: 0,
      grams: 5,
      loanAmount: 125,
      assessedValue: 150,
    });
  });

  it("keeps incomplete or whitespace-only delivery records pending", () => {
    const pending = [
      bill("no-date", { deliveryNo: "1", items: [item("Ring 1")] }),
      bill("no-number", { deliveryDate: "2026-01-02", items: [item("Chain 1")] }),
      bill("whitespace", { deliveryNo: " ", deliveryDate: " ", items: [item("Studs 1")] }),
    ];

    expect(jewelStock(pending)).toMatchObject({ billCount: 3, pledgeRows: 3, knownPieces: 3 });
  });

  it("filters mixed-metal bills per item and keeps the pending unknown-metal warning global", () => {
    const mixed = bill("mixed", {
      items: [
        item("Ring 2", { metal: "Gold", grams: 1.25, assessedValue: 100.1, loanAmount: 90.1 }),
        item("Chain 1", { metal: "Silver", grams: 2.5, assessedValue: 200.2, loanAmount: 150.2 }),
        item("Older description", { metal: undefined, grams: 3, assessedValue: 300.3, loanAmount: 250.3 }),
      ],
    });
    const deliveredUnknown = bill("delivered-unknown", {
      deliveryNo: "1",
      deliveryDate: "2026-01-02",
      items: [item("Unknown 1", { metal: undefined })],
    });

    const gold = jewelStock([mixed, deliveredUnknown], "Gold");
    expect(gold.lines.map(line => line.item.metal)).toEqual(["Gold"]);
    expect(gold).toMatchObject({ billCount: 1, pledgeRows: 1, knownPieces: 2, grams: 1.25, loanAmount: 90.1, assessedValue: 100.1, unknownMetalRows: 1 });

    const all = jewelStock([mixed, deliveredUnknown]);
    expect(all.pledgeRows).toBe(3);
    expect(all.unknownMetalRows).toBe(1);
    expect(all.loanAmount).toBe(490.6);
  });

  it("counts pieces only for fully parseable rows and sums money and grams in integer units", () => {
    const source = bill("precision", {
      items: [
        item("Ring 2, Studs 1", { grams: 0.1, loanAmount: 0.1, assessedValue: 0.1 }),
        item("Ring 3, Old necklace", { grams: 0.2, loanAmount: 0.2, assessedValue: 0.2 }),
      ],
    });

    expect(jewelStock([source])).toMatchObject({
      pledgeRows: 2,
      knownPieces: 3,
      unknownQuantityRows: 1,
      grams: 0.3,
      loanAmount: 0.3,
      assessedValue: 0.3,
    });
  });

  it("sorts by date, bill number, id, and item index without mutating source data", () => {
    const later = bill("z", { billNumber: 1, billDate: "2026-02-01", items: [item("Later 1")] });
    const tieById = bill("b", { billNumber: 2, items: [item("Second 1")] });
    const tieByNumber = bill("a", { billNumber: 1, items: [item("First 1"), item("Next 1")] });
    const input = [later, tieById, tieByNumber];
    const originalBills = [...input];
    const originalItems = input.map(row => [...row.items]);

    const result = jewelStock(input);
    expect(result.lines.map(line => `${line.bill.id}:${line.index}`)).toEqual(["a:0", "a:1", "b:0", "z:0"]);
    expect(result.billCount).toBe(3);
    expect(input).toEqual(originalBills);
    expect(input.map(row => row.items)).toEqual(originalItems);
  });
});
