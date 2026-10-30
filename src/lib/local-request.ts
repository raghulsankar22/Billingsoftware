import { NextResponse } from "next/server";
import { baseDataDirectory, multiUserEnabled, runAsLocalUser } from "./local-session-context";
import { createLocalUsers } from "./local-users";
import { localStorageEnabled } from "./storage-mode";

export const sessionCookie = "billing_session";
export function localRequestAllowed(request: Request) {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || request.headers.get("sec-fetch-site") === "cross-site") return false;
  const value = request.headers.get("origin");
  if (!value) return true;
  try { const origin = new URL(value); return origin.origin === value && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) && origin.protocol === url.protocol && origin.port === url.port; } catch { return false; }
}
export function requestToken(request: Request) {
  const match = request.headers.get("cookie")?.match(/(?:^|;\s*)billing_session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1];
}
export function withLocalSession<T extends (request: Request, ...args: any[]) => Promise<Response>>(handler: T): T {
  const wrapped = async (request: Request, ...args: any[]) => {
    if (!localStorageEnabled || !multiUserEnabled()) return handler(request, ...args);
    if (!localRequestAllowed(request)) return NextResponse.json({ error: "Open billing directly on this computer." }, { status: 403 });
    const users = createLocalUsers(baseDataDirectory());
    let user;
    try { user = users.session(requestToken(request)); } finally { users.close(); }
    if (!user) return NextResponse.json({ error: "Sign in is required." }, { status: 401, headers: { "cache-control": "no-store" } });
    return runAsLocalUser(user, () => handler(request, ...args));
  };
  return wrapped as T;
}
