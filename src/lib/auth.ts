import { createAdminSupabase } from "./supabase";

export function assertOwnerEmail(actual: string | undefined, configured: string | undefined) {
  const ownerEmail = configured?.trim().toLowerCase();
  if (!ownerEmail) throw new Error("BILLING_OWNER_EMAIL is not configured on the server.");
  if (actual?.toLowerCase() !== ownerEmail) throw new Error("This account is not authorized to access billing.");
}

export async function requireUser(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in is required.");
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Your session has expired. Please sign in again.");
  assertOwnerEmail(data.user.email, process.env.BILLING_OWNER_EMAIL);
  return data.user;
}

export async function requireOwnerProfile(ownerId: string) {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.from("business_profiles").select("*").eq("owner_id", ownerId).maybeSingle();
  if (error) throw error;
  return data;
}
