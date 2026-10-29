import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";
import { accountSlot } from "@/lib/accounts";
import { profileSchema } from "@/lib/profile-validation";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const account = accountSlot(request);
    const { data, error } = await createAdminSupabase().from("business_profiles").select("*").eq("owner_id", user.id).order("account_slot");
    if (error) throw error;
    return NextResponse.json({ profile: data?.find((profile) => profile.account_slot === account) ?? null, profiles: data ?? [] });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load profile" }, { status: 401 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const input = { ...profileSchema.parse(await request.json()), accountSlot: accountSlot(request) };
    const { data, error } = await createAdminSupabase().rpc("save_business_profile", { p_owner_id: user.id, p_profile: input });
    if (error) throw error;
    return NextResponse.json({ profile: data });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save profile" }, { status: 400 }); }
}
