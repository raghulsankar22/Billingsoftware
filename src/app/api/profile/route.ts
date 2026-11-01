import { withLocalSession } from "../../../lib/local-request";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";
import { accountSlot } from "@/lib/accounts";
import { profileSchema } from "@/lib/profile-validation";
import { localStorageEnabled } from "@/lib/storage-mode";
import { cloudMultiUserEnabled } from "@/lib/cloud-mode";

async function GETHandler(request: Request) {
  try {
    let user;
    // Only a failed sign-in check means signed out. A busy database must not end the session.
    try { user = await requireUser(request); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sign in is required." }, { status: 401 }); }
    const account = accountSlot(request);
    const { data, error } = await createAdminSupabase().from("business_profiles").select("*").eq("owner_id", user.id).order("account_slot");
    if (error) throw error;
    return NextResponse.json({ profile: data?.find((profile) => profile.account_slot === account) ?? null, profiles: data ?? [] });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load profile" }, { status: 400 }); }
}

async function POSTHandler(request: Request) {
  try {
    const user = await requireUser(request);
    const input = { ...profileSchema.parse(await request.json()), accountSlot: accountSlot(request) };
    const method = !localStorageEnabled && cloudMultiUserEnabled() ? "save_cloud_business_profile" : "save_business_profile";
    const { data, error } = await createAdminSupabase().rpc(method, { p_owner_id: user.id, p_profile: input });
    if (error) throw error;
    return NextResponse.json({ profile: data });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save profile" }, { status: 400 }); }
}

export const GET = withLocalSession(GETHandler);
export const POST = withLocalSession(POSTHandler);
