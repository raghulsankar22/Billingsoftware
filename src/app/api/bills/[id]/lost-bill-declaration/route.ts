import { withLocalSession } from "../../../../../lib/local-request";
import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { toBill } from "@/lib/bills";
import { syncBillToRegister } from "@/lib/register-sync";
import { localStorageEnabled } from "@/lib/storage-mode";
import { createAdminSupabase } from "@/lib/supabase";

async function POSTHandler(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!localStorageEnabled) return NextResponse.json({ error: "Lost bill declarations are available in local billing mode." }, { status: 501 });
    const user = await requireUser(request);
    const account = accountSlot(request);
    const profile = await requireOwnerProfile(user.id, account);
    if (!profile) return NextResponse.json({ error: "Set up this business account first." }, { status: 422 });
    const { id } = await context.params;
    const db = createAdminSupabase();
    const { error: saveError } = await db.rpc("mark_lost_bill_declared", { p_owner_id: user.id, p_bill_id: id, p_account_slot: account });
    if (saveError) throw saveError;
    const { data, error } = await db.from("bills").select("*, bill_items(*)").eq("id", id).eq("profile_id", profile.id).single();
    if (error) throw error;
    const bill = toBill({ ...data, items: data.bill_items });
    const warnings: string[] = [];
    try {
      await syncBillToRegister(profile.id, bill);
      await db.from("bills").update({ excel_sync_status: "synced", excel_sync_error: null }).eq("id", id).eq("profile_id", profile.id);
      bill.excelSyncStatus = "synced"; bill.excelSyncError = undefined;
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "Excel sync failed.";
      try { await db.from("bills").update({ excel_sync_status: "failed", excel_sync_error: message }).eq("id", id).eq("profile_id", profile.id); } catch {}
      bill.excelSyncStatus = "failed"; bill.excelSyncError = message;
      warnings.push(`Marked as signed. Excel needs a retry: ${message}`);
    }
    return NextResponse.json({ bill, warnings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to mark the declaration as signed." }, { status: 400 });
  }
}

export const POST = withLocalSession(POSTHandler);
