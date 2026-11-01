import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import ExcelJS from "exceljs";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { createLocalDatabase, localOwnerId } from "./local-database";
import { suggestEnglish } from "./tamil-input";
import { translate } from "./language";
import { POST as createBill } from "../app/api/bills/route";
import { PATCH as editBill } from "../app/api/bills/[id]/route";
import { POST as createCustomer, PATCH as editCustomer } from "../app/api/customers/route";
import { POST as importBills } from "../app/api/import-historical/route";
import { previewHistoricalWorkbook } from "./historical-import";

vi.mock("@/lib/accounts", async () => import("./accounts"));
vi.mock("@/lib/validation", async () => import("./validation"));
vi.mock("@/lib/auth", async () => import("./auth"));
vi.mock("@/lib/supabase", async () => import("./supabase"));
vi.mock("@/lib/bills", async () => import("./bills"));
vi.mock("@/lib/register-sync", async () => import("./register-sync"));
vi.mock("@/lib/bill-pdf-storage", async () => import("./bill-pdf-storage"));
vi.mock("@/lib/bill-history", async () => import("./bill-history"));
vi.mock("@/lib/storage-mode", async () => import("./storage-mode"));
vi.mock("@/lib/cloud-mode", async () => import("./cloud-mode"));
vi.mock("@/lib/bill-update-outputs", async () => import("./bill-update-outputs"));
vi.mock("@/lib/local-bill-pdfs", async () => import("./local-bill-pdfs"));
vi.mock("@/lib/customers", async () => import("./customers"));

vi.mock("@/lib/local-database", async () => import("./local-database"));

let directory: string;
let database: ReturnType<typeof createLocalDatabase>;
let profileId: string;
const request = (resource: string, body: unknown, method = "POST") => new Request("http://127.0.0.1:3103/api/" + resource + "?account=1", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const input = () => ({ billDate: "2026-10-03", customerName: suggestEnglish("குமார்"), fatherName: suggestEnglish("ராஜா"), address: suggestEnglish("12 சென்னை தெரு"), phone: "9876543210", governmentId: "123456789012", items: [{ metal: "Gold", particulars: suggestEnglish("மோதிரம் 2"), remarks: "Broken", grams: 2.5, assessedValue: 1100, loanAmount: 1000 }] });
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "billing-tamil-workflow-"));
  vi.stubEnv("LOCAL_DATA_DIR", directory); vi.stubEnv("BILLING_MULTI_USER", "0");
  database = createLocalDatabase(directory);
  const result = await database.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { businessName: "Synthetic Finance", address: "12 Test Street", phone: "9876543210", accountSlot: 1, nextBillNumber: 1 } });
  expect(result.error).toBeNull(); profileId = result.data.id;
});
afterEach(() => {
  database.close(); vi.unstubAllEnvs();
  if (dirname(directory) !== tmpdir().replace(/[\/]$/, "") || !basename(directory).startsWith("billing-tamil-workflow-")) throw new Error("Unsafe fixture cleanup");
  rmSync(directory, { recursive: true, force: true });
});

describe("Tamil workflow persistence", () => {
  it("persists confirmed English unchanged in database, actual Excel and PDF", async () => {
    expect(translate("ta", "Gold")).not.toBe("Gold");
    const response = await createBill(request("bills", input()));
    const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(201);
    expect(result.bill).toMatchObject({ customerName: "Kumar", fatherName: "Raja", address: "12 Chennai Street", phone: "9876543210", governmentId: "123456789012", items: [{ metal: "Gold", particulars: "Ring 2", remarks: "Broken", grams: 2.5, loanAmount: 1000 }] });
    const saved = await database.from("bills").select("*, bill_items(*)").eq("id", result.bill.id).single();
    expect(saved.data).toMatchObject({ customer_name: "Kumar", father_name: "Raja", address: "12 Chennai Street", excel_sync_status: "synced", pdf_error: null });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(join(directory, "registers", profileId + ".xlsx"));
    const row = workbook.getWorksheet("Bills")!.getRow(2).values;
    expect(JSON.stringify(row)).toContain("Kumar"); expect(JSON.stringify(row)).toContain("Ring 2"); expect(JSON.stringify(row)).not.toMatch(/[஀-௿]/u);
    const pdf = await PDFDocument.load(readFileSync(join(directory, "bill-pdfs", saved.data.pdf_storage_path)));
    const page = pdf.getPages()[0]; const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map(ref => pdf.context.lookup(ref)) : [contents];
    const text = streams.filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream).map(stream => Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")).join("\n");
    expect(text).toContain("Kumar"); expect(text).toContain("Raja"); expect(text).toContain("Ring 2");
  });
  it("refuses Tamil on bill and customer create/edit without changing saved records", async () => {
    expect((await createBill(request("bills", { ...input(), customerName: "குமார்" }))).status).toBe(400);
    const bill = (await (await createBill(request("bills", input()))).json()).bill;
    expect((await editBill(request("bills/" + bill.id, { ...input(), address: "சென்னை தெரு" }, "PATCH"), { params: Promise.resolve({ id: bill.id }) })).status).toBe(400);
    const customer = { name: "Kumar", fatherName: "Raja", address: "12 Chennai Street", phone: "", aadhaar: "" };
    expect((await createCustomer(request("customers", { ...customer, name: "குமார்" }))).status).toBe(400);
    const response = await createCustomer(request("customers", customer)); const created = (await response.json()).customer;
    expect(response.status).toBe(201);
    expect((await editCustomer(request("customers", { ...customer, id: created.id, fatherName: "ராஜா" }, "PATCH"))).status).toBe(400);
    expect((await database.from("bills").select().eq("id", bill.id).single()).data.address).toBe("12 Chennai Street");
  });
  it("reports the historical row and column, rejecting the whole workbook before backups", async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Bills");
    sheet.addRow(["DATE", "BILL NO", "Address", "NAME", "Particulars", "PHONE", "AMOUNT"]);
    sheet.addRow(["1/4/22", 10, "12 Test Street", "Kumar", "Ring", "", 1000]);
    sheet.addRow(["1/4/22", 11, "12 Test Street", "குமார்", "Ring", "", 1000]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const preview = await previewHistoricalWorkbook(bytes); expect(preview.rows[1].issues.join(" ")).toContain("Customer name:");
    const form = new FormData(); form.append("file", new File([bytes], "old.xlsx")); form.append("metals", JSON.stringify({ "Bills:2": "Gold", "Bills:3": "Gold" }));
    const response = await importBills(new Request("http://127.0.0.1:3103/api/import-historical?account=1", { method: "POST", body: form }));
    expect(response.status).toBe(400); expect((await response.json()).error).toContain("row 3: Customer name:");
    expect((await database.from("bills").select()).data).toHaveLength(0);
    expect(readdirSync(directory)).not.toContain("backups");
  });
});
