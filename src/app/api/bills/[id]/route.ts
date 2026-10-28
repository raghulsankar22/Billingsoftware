import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { billSchema } from "@/lib/validation";
import { createAdminSupabase } from "@/lib/supabase";
import { toBill, totals } from "@/lib/bills";
import { refreshUpdatedBillOutputs } from "@/lib/bill-update-outputs";
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
    const warnings = await refreshUpdatedBillOutputs(profile, bill, result.previousPdfPath, result.previousDeliveryPdfPath);
    return NextResponse.json({ bill, warnings });
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
    const { data: existing, error: findError } = await db.from("bills").select("id,pdf_storage_path,delivery_pdf_storage_path").eq("id", id).eq("profile_id", profile.id).single();
    if (findError || !existing) throw new Error("Bill not found in this account.");
    const pdfPaths = [existing.pdf_storage_path, existing.delivery_pdf_storage_path].filter((path): path is string => typeof path === "string" && path.length > 0);
    if (pdfPaths.length) {
      const { error: removeError } = await db.storage.from("bill-pdfs").remove(pdfPaths);
      if (removeError) throw removeError;
    }
    const { data: deleted, error: deleteError } = await db.rpc("delete_bill", { p_owner_id: user.id, p_bill_id: id });
    if (deleteError) throw deleteError;
    try {
      await syncAccountRegister(profile.id);
      return NextResponse.json({ ok: true, nextBillNumber: deleted.nextBillNumber, registerSyncStatus: "synced" });
    } catch (syncError) {
      return NextResponse.json({ ok: true, nextBillNumber: deleted.nextBillNumber, registerSyncStatus: "failed", warning: `Bill deleted, but Excel needs a retry: ${syncError instanceof Error ? syncError.message : "sync failed"}` });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete bill" }, { status: 400 });
  }
}
