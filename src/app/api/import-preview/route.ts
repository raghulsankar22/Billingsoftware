import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { loadReportBills } from "@/lib/excel-report";
import { previewHistoricalWorkbook } from "@/lib/historical-import";
import { withLocalSession } from "@/lib/local-request";
import { localStorageEnabled } from "@/lib/storage-mode";

async function preview(request: Request) {
  try {
    if (!localStorageEnabled) throw new Error("Excel import preview is available in the offline app only.");
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) throw new Error("Set up this business account first.");
    const data = await request.formData();
    const file = data.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Choose an Excel .xlsx file.");
    if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("Choose a file smaller than 10 MB.");
    const [result, existing] = await Promise.all([previewHistoricalWorkbook(Buffer.from(await file.arrayBuffer())), loadReportBills(profile.id, { query: "" })]);
    const numbers = new Set(existing.map(bill => bill.billNumber));
    result.rows.forEach(row => { if (numbers.has(Number(row.billNo))) row.issues.push("Bill number already exists in this account"); });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read this workbook." }, { status: 400 });
  }
}
export const POST = withLocalSession(preview);
