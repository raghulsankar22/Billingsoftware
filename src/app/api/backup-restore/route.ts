import { NextResponse } from "next/server";
import { requireUser } from "../../../lib/auth";
import { listBackups, restoreBackup } from "../../../lib/backups";
import { createLocalDatabase, localDataDirectory } from "../../../lib/local-database";
import { withLocalSession } from "../../../lib/local-request";
import { syncAllAccountRegisters } from "../../../lib/register-sync";
import { localStorageEnabled } from "../../../lib/storage-mode";
import { validationMessage } from "../../../lib/validation";

const headers = { "cache-control": "no-store" };
function failure(error: unknown) { return NextResponse.json({ error: validationMessage(error, "The backup could not be restored.") }, { status: 400, headers }); }
async function available(request: Request) {
  if (!localStorageEnabled) throw new Error("Restore is available only in the offline app.");
  return requireUser(request);
}

/** The dated backups found in the chosen folder, newest first. */
export const GET = withLocalSession(async (request: Request) => {
  try { await available(request); return NextResponse.json({ backups: listBackups(localDataDirectory()) }, { headers }); } catch (error) { return failure(error); }
});

/** Replaces the current bills with the chosen backup. The current bills are kept as a safety copy first. */
export const POST = withLocalSession(async (request: Request) => {
  try {
    const user = await available(request);
    const directory = localDataDirectory();
    const body = await request.json().catch(() => ({}));
    const result = await restoreBackup(directory, createLocalDatabase(directory), body?.file);
    let warning = "";
    try { await syncAllAccountRegisters(user.id); } catch { warning = "Bills were restored, but Excel could not be refreshed. Use Refresh Excel on the Dashboard."; }
    return NextResponse.json({ ...result, warning }, { headers });
  } catch (error) { return failure(error); }
});
