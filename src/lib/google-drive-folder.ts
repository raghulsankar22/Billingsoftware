import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isInGoogleDrive, type DriveSuggestion } from "./google-drive-path";

export { isInGoogleDrive, type DriveSuggestion };

const subfolder = "Billing Backups";

/**
 * Finds Google Drive for desktop on this computer. It appears as a drive letter with a "My Drive" folder
 * (usually G:) or as a "Google Drive" folder in the user's profile. Nothing is created here.
 */
export function findGoogleDriveFolders(options: { platform?: string; home?: string; exists?: (path: string) => boolean } = {}): DriveSuggestion[] {
  if ((options.platform ?? process.platform) !== "win32") return [];
  const exists = options.exists ?? existsSync;
  const home = options.home ?? homedir();
  const roots = [...Array.from({ length: 24 }, (_, index) => `${String.fromCharCode(67 + index)}:\\My Drive`), `${home}\\Google Drive\\My Drive`, `${home}\\Google Drive`, `${home}\\My Drive`];
  const found: DriveSuggestion[] = [];
  for (const root of roots) {
    let present = false;
    try { present = exists(root); } catch { present = false; }
    if (present) found.push({ label: "Google Drive", folder: `${root}\\${subfolder}` });
  }
  return found;
}
