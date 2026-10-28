import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { toBill } from "@/lib/bills";
import { localStorageEnabled } from "@/lib/storage-mode";
import { createAdminSupabase } from "@/lib/supabase";

export async function GET(request: Request) {
  try {
    if (!localStorageEnabled) return NextResponse.json({ error: "Delivery is available in local billing mode." }, { status: 501 });
    const user = await requireUser(request);
    const value = new URL(request.url).searchParams.get("billNumber")?.trim().replace(/^#/, "") ?? "";
    const billNumber = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(billNumber) || billNumber < 1 || billNumber >= 2_147_483_647) throw new Error("Enter a valid bill number.");
    const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) return NextResponse.json({ error: "Set up this business account first." }, { status: 422 });
    const { data, error } = await createAdminSupabase().from("bills").select("*, bill_items(*)").eq("profile_id", profile.id).eq("bill_number", billNumber).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: `Bill #${billNumber} was not found in this account.` }, { status: 404 });
    return NextResponse.json({ bill: toBill({ ...data, items: data.bill_items }) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to find this bill." }, { status: 400 });
  }
}
