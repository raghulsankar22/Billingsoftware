import { withLocalSession } from "../../../lib/local-request";
import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { billSchema } from "@/lib/validation";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";
import { toBill, totals } from "@/lib/bills";
import { syncBillToRegister } from "@/lib/register-sync";
import { persistBillPdf } from "@/lib/bill-pdf-storage";
import { loadBillHistory } from "@/lib/bill-history";
import { localStorageEnabled } from "@/lib/storage-mode";
import { cloudMultiUserEnabled } from "@/lib/cloud-mode";

async function GETHandler(request: Request) {
  try {
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) return NextResponse.json({ bills: [] });
    const { searchParams } = new URL(request.url);
    return NextResponse.json(await loadBillHistory(createAdminSupabase(), profile.id, searchParams));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load bills" }, { status: 400 }); }
}

async function POSTHandler(request: Request) {
  try {
    // The older cloud RPC cannot safely issue the current metal-aware,
    // offline-synchronized bills. Do not create incomplete online records.
    if (!localStorageEnabled && cloudMultiUserEnabled()) return NextResponse.json({ error: "Online bill creation is not available until synchronization is ready." }, { status: 503 });
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) return NextResponse.json({ error: "Create your business profile before issuing a bill." }, { status: 422 });
    const input = billSchema.parse(await request.json());
    const total = totals(input);
    const payload = { ...input, accountSlot: accountSlot(request), totalAssessedValue: total.assessedValue, totalLoanAmount: total.loanAmount, items: input.items.map((item, sortOrder) => ({ ...item, sortOrder })) };
    const supabase = createAdminSupabase();
    const { data: result, error: createError } = await supabase.rpc("create_bill", { p_owner_id: user.id, p_bill: payload });
    if (createError) throw createError;
    const { data, error } = await supabase.from("bills").select("*, bill_items(*)").eq("id", result.id).single();
    if (error) throw error;
    const bill = toBill({ ...data, items: data.bill_items });
    try {
      await persistBillPdf(profile, bill);
    } catch (pdfError) {
      await supabase.from("bills").update({ pdf_error: pdfError instanceof Error ? pdfError.message : "PDF storage failed" }).eq("id", bill.id);
    }
    try {
      await syncBillToRegister(profile.id, bill);
      await supabase.from("bills").update({ excel_sync_status: "synced", excel_sync_error: null }).eq("id", bill.id);
      bill.excelSyncStatus = "synced";
    } catch (syncError) {
      await supabase.from("bills").update({ excel_sync_status: "failed", excel_sync_error: syncError instanceof Error ? syncError.message : "Excel sync failed" }).eq("id", bill.id);
      bill.excelSyncStatus = "failed";
    }
    return NextResponse.json({ bill }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create bill" }, { status: 400 }); }
}

export const GET = withLocalSession(GETHandler);
export const POST = withLocalSession(POSTHandler);
