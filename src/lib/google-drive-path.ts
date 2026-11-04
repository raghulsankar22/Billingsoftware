/** A folder in Google Drive for desktop: files saved there are uploaded to the owner's Google Drive automatically. */
export type DriveSuggestion = { label: string; folder: string };

const insideDrive = /(^|[\\/])(My Drive|Google Drive)([\\/]|$)/i;

/** True when a folder path is inside a Google Drive for desktop folder (My Drive or Google Drive). Safe for the browser. */
export function isInGoogleDrive(folder: string | null | undefined) { return typeof folder === "string" && insideDrive.test(folder); }
