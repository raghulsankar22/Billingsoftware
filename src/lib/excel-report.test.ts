import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";
import { buildReportRegister, loadReportBills, reportFilters } from "./excel-report";
import { registerHeaders } from "./types";

const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], ranges: [] as number[][], profiles: [] as string[], dates: [] as string[][], error: null as unknown }));
vi.mock("./supabase", () => ({ createAdminSupabase: () => ({ from: () => ({ select: () => {
  const query = {
    eq: (_key: string, value: string) => { db.profiles.push(value); return query; },
    order: () => query,
    gte: (key: string, value: string) => { db.dates.push([key, value]); return query; },
    lte: (key: string, value: string) => { db.dates.push([key, value]); return query; },
    range: async (from: number, to: number) => { db.ranges.push([from, to]); return { data: db.rows.slice(from, to + 1), error: db.error }; },
  }; return query;
} }) }) }));

const row = (number: number) => ({ id: `id-${number}`, bill_number: number, bill_date: "2026-10-03", status: "issued", customer_name: "Customer", father_name: "Parent", address: "Address", phone: "0123456789", total_assessed_value: "100", total_loan_amount: "80", bill_items: [{ particulars: "Gold", grams: "1", assessed_value: "100", loan_amount: "80", sort_order: 0 }], created_at: "2026-10-03" });
beforeEach(() => { db.rows = []; db.ranges = []; db.profiles = []; db.dates = []; db.error = null; });

it("exports all bills beyond the default database page, with owner-scoped pages", async () => {
  db.rows = Array.from({ length: 1001 }, (_, index) => row(index + 1));
  const bills = await loadReportBills("owner-profile", reportFilters(new URLSearchParams()));
  expect(bills).toHaveLength(1001);
  expect(db.ranges).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  expect(db.profiles).toEqual(["owner-profile", "owner-profile", "owner-profile"]);
});

it("uses literal search, valid date filters, and exact numeric bill matching", async () => {
  db.rows = [{ ...row(1), customer_name: "A, B" }, row(2)];
  const bills = await loadReportBills("owner", reportFilters(new URLSearchParams("q=A%2C+B&from=2026-10-01&to=2026-10-03")));
  expect(bills.map((bill) => bill.billNumber)).toEqual([1]);
  expect(db.dates).toEqual([["bill_date", "2026-10-01"], ["bill_date", "2026-10-03"]]);
  db.rows = [{ ...row(2), phone: "0000000000" }, { ...row(12), phone: "0000000000" }];
  expect((await loadReportBills("owner", { query: "2" })).map((bill) => bill.billNumber)).toEqual([2]);
  expect(() => reportFilters(new URLSearchParams("from=2026-02-30"))).toThrow(/valid dates/);
  expect(() => reportFilters(new URLSearchParams("from=2026-10-03&to=2026-10-01"))).toThrow(/start date/);
});

it("roundtrips the required nine columns, leading-zero phones, numeric money, and visible void rows", async () => {
  db.rows = [{ ...row(1), delivery_no: "D-01", delivery_date: "2026-10-15" }, { ...row(2), status: "void", customer_name: "=1+1" }];
  const workbook = buildReportRegister(await loadReportBills("owner", { query: "" }));
  const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(await workbook.xlsx.writeBuffer() as never);
  const sheet = loaded.getWorksheet("Bills")!;
  expect(sheet.getRow(1).values).toEqual([undefined, ...registerHeaders]);
  expect(sheet.getTable("Bills")).toMatchObject({ table: { tableRef: "A1:I3" } });
  expect(sheet.getCell("H2").value).toBe("0123456789"); expect(sheet.getCell("I2").value).toBe(80);
  expect(sheet.getCell("A2").value).toBe("D-01"); expect(sheet.getCell("B2").value).toBe("2026-10-15");
  expect(sheet.getCell("H2").numFmt).toBe("@"); expect(sheet.getCell("B2").numFmt).toBe("@");
  expect(sheet.getCell("F3").value).toBe("=1+1"); expect(sheet.getCell("G3").value).toMatch(/^VOID — /);
  expect(sheet.getRow(3).font.strike).toBe(true);
});

it("exports genuinely empty optional cells for blank or missing customer details", async () => {
  db.rows = [
    { ...row(1), delivery_no: "", delivery_date: "", phone: "" },
    { ...row(2), delivery_no: null, delivery_date: null, phone: null },
    { ...row(3), phone: undefined },
  ];
  const workbook = buildReportRegister(await loadReportBills("owner", { query: "" }));
  const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(await workbook.xlsx.writeBuffer() as never);
  const sheet = loaded.getWorksheet("Bills")!;
  for (const rowNumber of [2, 3, 4]) {
    for (const column of ["A", "B", "H"]) expect(sheet.getCell(`${column}${rowNumber}`).value).toBeNull();
    expect(sheet.getCell(`I${rowNumber}`).value).toBe(80);
  }
});

it("fails the download on a database error instead of silently exporting partial history", async () => {
  db.error = { message: "database unavailable" };
  await expect(loadReportBills("owner", { query: "" })).rejects.toThrow(/retry the download/);
});
