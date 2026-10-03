import { createBrowserSupabase } from "@/lib/supabase";

export async function api(path: string, init?: RequestInit) {
  const supabase = createBrowserSupabase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}
