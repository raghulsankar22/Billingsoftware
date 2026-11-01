import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { previewHistoricalWorkbook } from "./historical-import";

async function example() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bills");
  sheet.addRow(["Delivery No", "Delivery Date", "DATE", "BILL NO", "Address", "NAME", "Particulars", "PHONE", "AMOUNT"]);
  sheet.addRow([6132, "1/5/22", "1/4/22", 7001, "Sourashtra Street", "K.Rajendhran", "Minor Chain", "", 11000]);
  sheet.addRow(["", "31/5/22", "1/4/22", 7003, "Vishnu Nagar", "M.Yuvaragj", "Minor Chain", "", 20500]);
  sheet.addRow(["", "", new Date("2022-04-04T00:00:00Z"), 7003, "Vishnu Nagar", "Someone", "Ring", "", 5000]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("historical Excel preview", () => {
  it("reads the sample columns and preserves a delivery date without inventing a number", async () => {
    const { rows } = await previewHistoricalWorkbook(await example());
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ billNo: "7001", billDate: "2022-04-01", deliveryNo: "6132", deliveryDate: "2022-05-01", amount: 11000, phone: "" });
    expect(rows[1]).toMatchObject({ billNo: "7003", deliveryNo: "", deliveryDate: "2022-05-31", amount: 20500 });
    expect(rows[2].billDate).toBe("2022-04-04");
    expect(rows[1].issues).toContain("Duplicate bill number in file");
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
