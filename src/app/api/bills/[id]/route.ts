import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { billSchema } from "@/lib/validation";
import { createAdminSupabase } from "@/lib/supabase";
import { toBill, totals } from "@/lib/bills";
import { persistBillPdf } from "@/lib/bill-pdf-storage";
import { syncAccountRegister } from "@/lib/register-sync";
import { localStorageEnabled } from "@/lib/storage-mode";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    if (!localStorageEnabled) return NextResponse.json({ error: "In-place editing is available in local billing mode." }, { status: 501 });
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) return NextResponse.json({ error: "Business profile is required." }, { status: 422 });
    const { id } = await context.params;
    const input = billSchema.parse(await request.json());
    const total = totals(input);
    const db = createAdminSupabase();
    const { data: result, error: editError } = await db.rpc("edit_bill", { p_owner_id: user.id, p_bill_id: id, p_bill: { ...input, accountSlot: accountSlot(request), totalAssessedValue: total.assessedValue, totalLoanAmount: total.loanAmount } });
    if (editError) throw editError;
    const { data, error } = await db.from("bills").select("*, bill_items(*)").eq("id", result.id).eq("profile_id", profile.id).single();
    if (error) throw error;
    const bill = toBill({ ...data, items: data.bill_items });
    let pdfSaved = false;
    try {
      await persistBillPdf(profile, bill, true);
      pdfSaved = true;
    } catch (pdfError) {
      const message = pdfError instanceof Error ? pdfError.message : "PDF storage failed";
      await db.from("bills").update({ pdf_error: message }).eq("id", id).eq("profile_id", profile.id);
    }
    if (pdfSaved && result.previousPdfPath) {
      const { error: cleanupError } = await db.storage.from("bill-pdfs").remove([result.previousPdfPath]);
      if (cleanupError) await db.from("bills").update({ pdf_error: `Previous PDF cleanup failed: ${cleanupError.message}` }).eq("id", id).eq("profile_id", profile.id);
    }
    try {
      await syncAccountRegister(profile.id);
      const { error: statusError } = await db.from("bills").update({ excel_sync_status: "synced", excel_sync_error: null }).eq("id", id).eq("profile_id", profile.id);
      if (statusError) throw statusError;
      bill.excelSyncStatus = "synced";
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "Excel sync failed";
      await db.from("bills").update({ excel_sync_status: "failed", excel_sync_error: message }).eq("id", id).eq("profile_id", profile.id);
      bill.excelSyncStatus = "failed";
      bill.excelSyncError = message;
    }
    return NextResponse.json({ bill });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to edit bill" }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    if (!localStorageEnabled) return NextResponse.json({ error: "Bill deletion is available in local billing mode." }, { status: 501 });
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) return NextResponse.json({ error: "Business profile is required." }, { status: 422 });
    const { id } = await context.params;
    const db = createAdminSupabase();
    const { data: existing, error: findError } = await db.from("bills").select("id,pdf_storage_path").eq("id", id).eq("profile_id", profile.id).single();
    if (findError || !existing) throw new Error("Bill not found in this account.");
    if (existing.pdf_storage_path) {
      const { error: removeError } = await db.storage.from("bill-pdfs").remove([existing.pdf_storage_path]);
      if (removeError) throw removeError;
    }
    const { error: deleteError } = await db.rpc("delete_bill", { p_owner_id: user.id, p_bill_id: id });
    if (deleteError) throw deleteError;
    try {
      await syncAccountRegister(profile.id);
      return NextResponse.json({ ok: true, registerSyncStatus: "synced" });
    } catch (syncError) {
      return NextResponse.json({ ok: true, registerSyncStatus: "failed", warning: `Bill deleted, but Excel needs a retry: ${syncError instanceof Error ? syncError.message : "sync failed"}` });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete bill" }, { status: 400 });
  }
}
