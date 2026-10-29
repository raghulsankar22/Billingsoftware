import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { localDataDirectory } from "./local-database";

/** Include earlier rendered versions when permanently deleting a local bill. */
export async function localBillPdfPaths(profileId: string, billId: string, dataDirectory = localDataDirectory()) {
  if (!/^[\w-]+$/.test(profileId) || !/^[\w-]+$/.test(billId)) throw new Error("Invalid bill PDF owner.");
  const filename = new RegExp(`^${billId}(?:-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?\\.pdf$`, "i");
  try {
    const entries = await readdir(join(dataDirectory, "bill-pdfs", profileId), { withFileTypes: true });
    return entries.filter(entry => entry.isFile() && filename.test(entry.name)).map(entry => `${profileId}/${entry.name}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
