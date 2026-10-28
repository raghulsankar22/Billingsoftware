import { createBrowserSupabase } from "@/lib/supabase-browser";
import { localStorageEnabled } from "@/lib/storage-mode";

export async function requestHeaders(): Promise<Record<string, string>> {
  if (localStorageEnabled) return {};
  const { data } = await createBrowserSupabase().auth.getSession();
  if (!data.session) throw new Error("Please sign in again.");
  return { Authorization: `Bearer ${data.session.access_token}` };
}

export async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...await requestHeaders(), ...init?.headers } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}
