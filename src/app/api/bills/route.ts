import { NextResponse } from "next/server";
import { billSchema } from "@/lib/validation";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";
import { toBill, totals } from "@/lib/bills";
import { syncBillToOneDrive } from "@/lib/onedrive";
import { persistBillPdf } from "@/lib/bill-pdf-storage";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id);
    if (!profile) return NextResponse.json({ bills: [] });
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim();
    let requestQuery = createAdminSupabase().from("bills").select("*, bill_items(*)").eq("profile_id", profile.id).order("bill_number", { ascending: false });
    if (query) requestQuery = requestQuery.or(`customer_name.ilike.%${query}%,phone.ilike.%${query}%,bill_number.eq.${Number(query) || -1}`);
    const { data, error } = await requestQuery.limit(100);
    if (error) throw error;
    return NextResponse.json({ bills: (data ?? []).map((bill) => toBill({ ...bill, items: bill.bill_items })) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load bills" }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id);
    if (!profile) return NextResponse.json({ error: "Create your business profile before issuing a bill." }, { status: 422 });
    const input = billSchema.parse(await request.json());
    const total = totals(input);
    const payload = { ...input, totalAssessedValue: total.assessedValue, totalLoanAmount: total.loanAmount, items: input.items.map((item, sortOrder) => ({ ...item, sortOrder })) };
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
      await syncBillToOneDrive(profile.id, bill);
      await supabase.from("bills").update({ excel_sync_status: "synced", excel_sync_error: null }).eq("id", bill.id);
      bill.excelSyncStatus = "synced";
    } catch (syncError) {
      await supabase.from("bills").update({ excel_sync_status: "failed", excel_sync_error: syncError instanceof Error ? syncError.message : "Excel sync failed" }).eq("id", bill.id);
      bill.excelSyncStatus = "failed";
    }
    return NextResponse.json({ bill }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create bill" }, { status: 400 }); }
}
