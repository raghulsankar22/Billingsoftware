import { createBrowserSupabase } from "@/lib/supabase-browser";
import { localStorageEnabled } from "@/lib/storage-mode";
import type { AccountSlot } from "@/lib/account-url";
import { withAccountSlot } from "@/lib/account-url";

export async function requestHeaders(): Promise<Record<string, string>> {
  if (localStorageEnabled) return {};
  const { data } = await createBrowserSupabase().auth.getSession();
  if (!data.session) throw new Error("Please sign in again.");
  return { Authorization: `Bearer ${data.session.access_token}` };
}

export async function api(path: string, accountSlot: AccountSlot, init?: RequestInit) {
  const response = await fetch(withAccountSlot(path, accountSlot), { ...init, headers: { "content-type": "application/json", ...await requestHeaders(), ...init?.headers } });
  const payload = await response.json();
  if (response.status === 401 && localStorageEnabled && typeof window !== "undefined") window.dispatchEvent(new Event("billing-session-expired"));
  if (!response.ok) throw Object.assign(new Error(payload.error || "Request failed"), { status: response.status, payload });
  return payload;
}
