import ExcelJS from "exceljs";
import { decrypt } from "./crypto";
import { createAdminSupabase } from "./supabase";
import { itemSummary } from "./money";
import { registerHeaders, type Bill } from "./types";

const graphBase = "https://graph.microsoft.com/v1.0";

function graphPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function accessToken(profileId: string) {
  const supabase = createAdminSupabase();
  const { data: connection, error } = await supabase.from("microsoft_connections").select("*").eq("profile_id", profileId).maybeSingle();
  if (error) throw error;
  if (!connection) throw new Error("Connect Microsoft OneDrive in Settings before syncing Excel.");
  const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Microsoft OAuth server credentials are not configured.");
  const response = await fetch(`https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID || "common"}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: decrypt(connection.refresh_token_encrypted), scope: "offline_access Files.ReadWrite" }),
  });
  if (!response.ok) throw new Error(`Microsoft token refresh failed: ${await response.text()}`);
  return { token: (await response.json()).access_token as string, path: connection.workbook_path as string };
}

async function graphFetch(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`${graphBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } });
  if (!response.ok) throw new Error(`OneDrive request failed (${response.status}): ${await response.text()}`);
  return response;
}

async function newRegister() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bills");
  sheet.columns = [16, 16, 14, 12, 34, 26, 55, 18, 18].map((width, index) => ({ header: registerHeaders[index], key: `c${index}`, width }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.addTable({ name: "Bills", ref: "A1", headerRow: true, totalsRow: false, columns: registerHeaders.map((name) => ({ name })), rows: [] });
  return workbook;
}

export async function syncBillToOneDrive(profileId: string, bill: Bill) {
  const { token, path } = await accessToken(profileId);
  const filePath = `/me/drive/root:/${graphPath(path)}:/content`;
  let workbook: ExcelJS.Workbook;
  let etag: string | undefined;
  try {
    const existing = await graphFetch(token, filePath);
    etag = existing.headers.get("etag") ?? undefined;
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await existing.arrayBuffer()) as never);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("(404)")) throw error;
    workbook = await newRegister();
  }
  const sheet = workbook.getWorksheet("Bills") ?? workbook.addWorksheet("Bills");
  const existingBill = sheet.getColumn(4).values.some((value) => Number(value) === bill.billNumber);
  if (!existingBill) {
    const row = [bill.deliveryNo ?? "", bill.deliveryDate ?? "", bill.billDate, bill.billNumber, bill.address, bill.customerName, itemSummary(bill.items), bill.phone, bill.totalLoanAmount];
    sheet.addRow(row);
  }
  sheet.getColumn(9).numFmt = '₹#,##0.00';
  const table = sheet.getTable("Bills");
  if (table) table.ref = `A1:I${sheet.rowCount}`;
  const bytes = await workbook.xlsx.writeBuffer();
  await graphFetch(token, filePath, { method: "PUT", headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ...(etag ? { "If-Match": etag } : {}) }, body: Buffer.from(bytes) });
}
