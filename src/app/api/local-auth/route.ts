import { NextResponse } from "next/server";
import { baseDataDirectory, multiUserEnabled } from "@/lib/local-session-context";
import { createLocalUsers } from "@/lib/local-users";
import { localRequestAllowed, requestToken, sessionCookie } from "@/lib/local-request";
import { localStorageEnabled } from "@/lib/storage-mode";
import { BackupMaintenanceError, withBackupOperation } from "@/lib/backup-maintenance";

const headers = { "cache-control": "no-store" };
const denied = () => NextResponse.json({ error: "Open billing directly on this computer." }, { status: 403, headers });
async function get(request: Request) {
  if (!localStorageEnabled || !localRequestAllowed(request)) return denied();
  if (!multiUserEnabled()) return NextResponse.json({ enabled: false }, { headers });
  const users = createLocalUsers(baseDataDirectory());
  try {
    const user = users.session(requestToken(request));
    return NextResponse.json({ enabled: true, needsSetup: users.needsSetup(), user }, { headers });
  } finally { users.close(); }
}
async function post(request: Request) {
  if (!localStorageEnabled || !multiUserEnabled() || !localRequestAllowed(request)) return denied();
  const users = createLocalUsers(baseDataDirectory());
  try {
    const input = await request.json();
    const token = requestToken(request);
    if (input.action === "setup") {
      if (!users.needsSetup()) return NextResponse.json({ error: "Setup has already been completed." }, { status: 403, headers });
      await users.create(input.username, input.password);
    } else if (input.action === "create") {
      await users.create(input.username, input.password, token);
      return NextResponse.json({ users: users.list(token!) }, { headers });
    } else if (input.action === "create-with-admin") {
      const created = await users.createWithAdminPassword(input.adminUsername, input.adminPassword, input.username, input.password);
      return NextResponse.json({ username: created.username }, { headers });
    } else if (input.action === "reset") {
      await users.resetPassword(token!, input.userId, input.password);
      return NextResponse.json({ ok: true }, { headers });
    } else if (input.action === "change-password") {
      await users.changePassword(token!, input.currentPassword, input.newPassword);
      const response = NextResponse.json({ ok: true }, { headers });
      response.cookies.set(sessionCookie, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
      return response;
    } else if (input.action === "list") {
      return NextResponse.json({ users: users.list(token!) }, { headers });
    } else if (input.action === "logout") {
      if (token) users.logout(token);
      const response = NextResponse.json({ ok: true }, { headers });
      response.cookies.set(sessionCookie, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
      return response;
    } else if (input.action !== "login") {
      return NextResponse.json({ error: "Unknown request." }, { status: 400, headers });
    }
    const result = await users.login(input.username, input.password);
    const response = NextResponse.json({ user: result.user }, { headers });
    response.cookies.set(sessionCookie, result.token, { httpOnly: true, sameSite: "strict", path: "/", maxAge: 12 * 60 * 60, secure: new URL(request.url).protocol === "https:" });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to complete sign-in." }, { status: 400, headers });
  } finally { users.close(); }
}

async function guarded(request: Request, handler: (request: Request) => Promise<Response>) {
  try { return await withBackupOperation(baseDataDirectory(), () => handler(request)); }
  catch (error) {
    if (!(error instanceof BackupMaintenanceError)) throw error;
    return NextResponse.json({ error: error.message }, { status: 503, headers });
  }
}
export const GET = (request: Request) => guarded(request, get);
export const POST = (request: Request) => guarded(request, post);
