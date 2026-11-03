import { NextResponse } from "next/server";
import { requireUser } from "../../../lib/auth";
import { backupStatus, chooseBackupFolder, runCompleteBackup } from "../../../lib/backups";
import { baseDataDirectory, currentLocalUser } from "../../../lib/local-session-context";
import { withLocalSession } from "../../../lib/local-request";
import { localStorageEnabled } from "../../../lib/storage-mode";
import { validationMessage } from "../../../lib/validation";

const headers = { "cache-control": "no-store" };
function failure(error: unknown) { return NextResponse.json({ error: validationMessage(error, "Backup could not be completed.") }, { status: 400, headers }); }
async function available(request: Request) {
  if (!localStorageEnabled) throw new Error("Backups are available only in the offline app.");
  await requireUser(request);
}

export const GET = withLocalSession(async (request: Request) => {
  try { await available(request); return NextResponse.json({ ...backupStatus(baseDataDirectory()), administrator: currentLocalUser()?.administrator === true }, { headers }); } catch (error) { return failure(error); }
});

export const PUT = withLocalSession(async (request: Request) => {
  try {
    await available(request);
    if (!currentLocalUser()?.administrator) return NextResponse.json({ error: "Administrator sign-in is required to change the complete backup folder." }, { status: 403, headers });
    const directory = baseDataDirectory();
    const body = await request.json().catch(() => ({}));
    chooseBackupFolder(directory, body?.folder);
    return NextResponse.json(await runCompleteBackup(directory), { headers });
  } catch (error) { return failure(error); }
});

export const POST = withLocalSession(async (request: Request) => {
  try {
    await available(request);
    const body = await request.json().catch(() => ({}));
    if (body?.auto === true && !backupStatus(baseDataDirectory()).due) return NextResponse.json(backupStatus(baseDataDirectory()), { headers });
    return NextResponse.json(await runCompleteBackup(baseDataDirectory(), { onlyIfDue: body?.auto === true }), { headers });
  } catch (error) { return failure(error); }
});
