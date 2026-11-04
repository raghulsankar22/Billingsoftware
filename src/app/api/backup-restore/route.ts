import { NextResponse } from "next/server";
import { requireUser } from "../../../lib/auth";
import { backupStatus, listBackups, previewBackup, restoreInstallation } from "../../../lib/backups";
import { baseDataDirectory, currentLocalUser } from "../../../lib/local-session-context";
import { phoneRequest, requestToken, sessionCookie, withLocalSession } from "../../../lib/local-request";
import { localStorageEnabled } from "../../../lib/storage-mode";
import { validationMessage } from "../../../lib/validation";

const headers = { "cache-control": "no-store" };
const phoneMessage = "Recovery must be done on the shop computer, not on a phone.";
function failure(error: unknown) { return NextResponse.json({ error: validationMessage(error, "The backup could not be restored.") }, { status: error instanceof Error && (error.message === "Administrator sign-in is required." || error.message === phoneMessage) ? 403 : 400, headers }); }
async function available(request: Request) {
  if (!localStorageEnabled) throw new Error("Restore is available only in the offline app.");
  await requireUser(request);
  if (phoneRequest(request)) throw new Error(phoneMessage);
  if (!currentLocalUser()?.administrator) throw new Error("Administrator sign-in is required.");
}

export const GET = withLocalSession(async (request: Request) => {
  try {
    await available(request);
    const root = baseDataDirectory();
    const file = new URL(request.url).searchParams.get("file");
    const folder = backupStatus(root).folder;
    if (file) {
      if (!folder) throw new Error("Choose a backup folder first.");
      return NextResponse.json({ preview: previewBackup(folder, file) }, { headers });
    }
    return NextResponse.json({ backups: listBackups(root) }, { headers });
  } catch (error) { return failure(error); }
});

export const POST = withLocalSession(async (request: Request) => {
  try {
    await available(request);
    const root = baseDataDirectory();
    const folder = backupStatus(root).folder;
    if (!folder) throw new Error("Choose a backup folder first.");
    const body = await request.json().catch(() => ({}));
    const result = await restoreInstallation(root, folder, body?.file, { token: requestToken(request), password: body?.currentPassword });
    const response = NextResponse.json({ ...result, warning: "Recovery completed. Close and reopen the app, then sign in using the restored login details." }, { headers });
    response.cookies.set(sessionCookie, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
    return response;
  } catch (error) { return failure(error); }
});
