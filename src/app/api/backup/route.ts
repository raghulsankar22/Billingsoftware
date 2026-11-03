import { NextResponse } from "next/server";
import { requireUser } from "../../../lib/auth";
import { backupStatus, chooseBackupFolder, runBackup } from "../../../lib/backups";
import { createLocalDatabase, localDataDirectory } from "../../../lib/local-database";
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
  try { await available(request); return NextResponse.json(backupStatus(localDataDirectory()), { headers }); } catch (error) { return failure(error); }
});

/** Saves the chosen folder and makes the first backup straight away. */
export const PUT = withLocalSession(async (request: Request) => {
  try {
    await available(request);
    const directory = localDataDirectory();
    const body = await request.json().catch(() => ({}));
    chooseBackupFolder(directory, body?.folder);
    return NextResponse.json(await runBackup(directory, createLocalDatabase(directory)), { headers });
  } catch (error) { return failure(error); }
});

/** `{ "auto": true }` backs up only when a day has passed; otherwise it always backs up. */
export const POST = withLocalSession(async (request: Request) => {
  try {
    await available(request);
    const directory = localDataDirectory();
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runBackup(directory, createLocalDatabase(directory), { onlyIfDue: body?.auto === true }), { headers });
  } catch (error) { return failure(error); }
});
