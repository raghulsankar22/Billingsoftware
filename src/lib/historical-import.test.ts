import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { previewHistoricalWorkbook } from "./historical-import";

async function example() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bills");
  sheet.addRow(["Delivery No", "Delivery Date", "DATE", "BILL NO", "Address", "NAME", "Particulars", "PHONE", "AMOUNT"]);
  sheet.addRow([901, "1/5/22", "1/4/22", 401, "Example Street One", "Example Borrower One", "Ring", "", 1500]);
  sheet.addRow(["", "31/5/22", "1/4/22", 403, "Example Street Two", "Example Borrower Two", "Ring", "", 2500]);
  sheet.addRow(["", "", new Date("2022-04-04T00:00:00Z"), 403, "Example Street Three", "Example Borrower Three", "Ring", "", 3500]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("historical Excel preview", () => {
  it("reads the sample columns and preserves a delivery date without inventing a number", async () => {
    const { rows } = await previewHistoricalWorkbook(await example());
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ billNo: "401", billDate: "2022-04-01", deliveryNo: "901", deliveryDate: "2022-05-01", amount: 1500, phone: "" });
    expect(rows[1]).toMatchObject({ billNo: "403", deliveryNo: "", deliveryDate: "2022-05-31", amount: 2500 });
    expect(rows[2].billDate).toBe("2022-04-04");
    expect(rows[1].issues).toContain("Duplicate bill number in file");
  });
  async function preview(rows: unknown[][], extra?: (workbook: ExcelJS.Workbook) => void) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Bills");
    sheet.addRow(["Delivery No", "Delivery Date", "Date", "Bill No", "Address", "Name", "Particulars", "Phone", "Amount"]);
    rows.forEach(row => sheet.addRow(row));
    extra?.(workbook);
    return previewHistoricalWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), "2026-11-01");
  }
  const good = ["", "", "1/4/22", 1, "Street", "Customer", "Ring", "", 1000];

  it("recognises the app's own VOID marker and removes it from the particulars", async () => {
    const { rows } = await preview([["", "", "1/4/22", 1, "Street", "Customer", "VOID — Gold: Ring (2 g)", "", 1000], good.map((value, index) => index === 3 ? 2 : value)]);
    expect(rows[0]).toMatchObject({ voided: true, particulars: "Gold: Ring (2 g)", issues: [] });
    expect(rows[0].notices.join()).toContain("voided");
    expect(rows[1].voided).toBe(false);
  });
  it("blocks values the import would reject, with readable reasons", async () => {
    const { rows } = await preview([
      ["", "", "1/4/22", 1, "Street", "Customer", "Ring", "9876543210, 9876543211", 1000],
      ["", "", "1/4/22", 2, "Street", "Customer", "R".repeat(181), "", 1000],
      ["", "", "1/4/22", 3, "Street", "N".repeat(121), "Ring", "", 1000],
      ["", "", "1/4/22", 4, "Street", "Customer", "Ring", "", 100000001],
      ["", "", "1/4/22", 2147483647, "Street", "Customer", "Ring", "", 1000],
    ]);
    expect(rows[0].issues.join()).toContain("Phone is too long");
    expect(rows[1].issues.join()).toContain("Particulars are too long");
    expect(rows[2].issues.join()).toContain("Customer name is too long");
    expect(rows[3].issues.join()).toContain("10 crore");
    expect(rows[4].issues.join()).toContain("too large");
  });
  it("reads two-digit years sensibly and blocks future dates", async () => {
    const { rows } = await preview([
      ["", "", "15/03/99", 1, "Street", "Customer", "Ring", "", 1000],
      ["", "", "15/03/2099", 2, "Street", "Customer", "Ring", "", 1000],
      ["", "2/12/2026", "1/4/22", 3, "Street", "Customer", "Ring", "", 1000],
    ]);
    expect(rows[0].billDate).toBe("1999-03-15");
    expect(rows[0].issues).toEqual([]);
    expect(rows[0].notices.join()).toContain("before 2000");
    expect(rows[1].issues).toContain("Bill date is in the future");
    expect(rows[2].issues).toContain("Delivery date is in the future");
  });
  it("flags a formula error instead of importing [object Object]", async () => {
    const { rows } = await preview([["", "", "1/4/22", 1, "Street", { formula: "1/0", result: { error: "#DIV/0!" } }, "Ring", "", 1000]]);
    expect(rows[0].name).toBe("");
    expect(rows[0].issues).toContain("A cell has a formula error");
  });
  it("treats 007 and 7 as the same bill and notes repeated delivery numbers", async () => {
    const { rows } = await preview([
      ["5", "1/5/22", "1/4/22", "007", "Street", "Customer", "Ring", "", 1000],
      ["05", "1/5/22", "1/4/22", 7, "Street", "Customer", "Ring", "", 1000],
    ]);
    expect(rows[0].issues).toContain("Duplicate bill number in file");
    expect(rows[1].issues).toContain("Duplicate bill number in file");
    expect(rows[0].notices).toContain("Delivery number also appears on another row");
  });
  it("warns about delivery numbers that can't be part of the sequence", async () => {
    const { rows } = await preview([["9876543210", "1/5/22", "1/4/22", 1, "Street", "Customer", "Ring", "", 1000], ["D-5", "1/5/22", "1/4/22", 2, "Street", "Customer", "Ring", "", 1000]]);
    expect(rows[0].issues).toEqual([]);
    expect(rows[0].notices.join()).toContain("won't affect numbering");
    expect(rows[1].notices.join()).toContain("won't affect numbering");
  });
  it("ignores empty sheets and only notes other unrecognised ones", async () => {
    const { rows, warnings, notes } = await preview([good], workbook => { workbook.addWorksheet("Sheet2"); workbook.addWorksheet("Summary").addRow(["Total", 1000]); });
    expect(rows).toHaveLength(1);
    expect(warnings).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Summary");
  });
  it("reports an invalid date instead of guessing", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Bills");
    sheet.addRow(["Date", "Bill No", "Address", "Name", "Particulars", "Amount"]);
    sheet.addRow(["31/2/22", 1, "Street", "Customer", "Ring", 1000]);
    const result = await previewHistoricalWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(result.rows[0].billDate).toBeNull();
    expect(result.rows[0].issues).toContain("Check bill date");
  });
});
