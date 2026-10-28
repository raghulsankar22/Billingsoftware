import { createClient } from "@supabase/supabase-js";
import { createLocalDatabase } from "./local-database";
import { localStorageEnabled } from "./storage-mode";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function createBrowserSupabase() {
  if (!url || !anonKey) throw new Error("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  return createClient(url, anonKey);
}

export function createAdminSupabase() {
  if (localStorageEnabled) return createLocalDatabase() as unknown as ReturnType<typeof createClient>;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase server credentials are not configured.");
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
