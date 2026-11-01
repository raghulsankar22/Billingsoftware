import { NextResponse } from "next/server";
import { accountSlot } from "../../../lib/accounts";
import { requireOwnerProfile, requireUser } from "../../../lib/auth";
import { previewHistoricalWorkbook } from "../../../lib/historical-import";
import { createLocalDatabase } from "../../../lib/local-database";
import { withLocalSession } from "../../../lib/local-request";
import { syncAccountRegister } from "../../../lib/register-sync";
import { localStorageEnabled } from "../../../lib/storage-mode";

async function importBills(request: Request) {
  try {
    if (!localStorageEnabled) throw new Error("Import is available only in the offline app.");
    const user = await requireUser(request);
    const account = accountSlot(request);
    const profile = await requireOwnerProfile(user.id, account);
    if (!profile) throw new Error("Set up this business account first.");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || !file.size || file.size > 10 * 1024 * 1024) throw new Error("Choose an Excel .xlsx file under 10 MB.");
    const choicesValue = form.get("metals");
    if (typeof choicesValue !== "string" || choicesValue.length > 1000000) throw new Error("Choose a metal for every bill.");
    const metals = JSON.parse(choicesValue) as Record<string, unknown>;
    if (!metals || typeof metals !== "object" || Array.isArray(metals)) throw new Error("Choose a metal for every bill.");
    const { rows, warnings } = await previewHistoricalWorkbook(Buffer.from(await file.arrayBuffer()));
    if (!rows.length || warnings.length) throw new Error("Review the workbook warnings before importing.");
    const allowedIssues = new Set(["Delivery date recorded; delivery number missing", "Delivery number recorded; delivery date missing"]);
    const invalid = rows.find(row => row.issues.some(issue => !allowedIssues.has(issue)));
    if (invalid) throw new Error(`Review sheet ${invalid.sheet}, row ${invalid.row}: ${invalid.issues.join("; ")}. Nothing was imported.`);
    const bills = rows.map(row => ({ ...row, billNo: Number(row.billNo), metal: metals[`${row.sheet}:${row.row}`] }));
    if (bills.some(bill => bill.metal !== "Gold" && bill.metal !== "Silver")) throw new Error("Choose Gold or Silver for every bill before importing.");
    const db = createLocalDatabase();
    await db.backupBeforeImport();
    const { data, error } = await db.rpc("import_historical_bills", { p_owner_id: user.id, p_account_slot: account, p_bills: bills });
    if (error) throw error;
    let warning = "";
    try {
      await syncAccountRegister(profile.id);
      const marked = await db.rpc("mark_import_register_synced", { p_owner_id: user.id, p_account_slot: account, p_ids: data.ids });
      if (marked.error) throw marked.error;
    }
    catch { warning = "Bills were saved, but Excel could not be refreshed. Use Refresh Excel on the Dashboard."; }
    return NextResponse.json({ count: data.count, warning }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import could not be completed." }, { status: 400 });
  }
}
export const POST = withLocalSession(importBills);
