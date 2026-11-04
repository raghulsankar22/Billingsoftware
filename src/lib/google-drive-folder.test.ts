import { describe, expect, it } from "vitest";
import { findGoogleDriveFolders, isInGoogleDrive } from "./google-drive-folder";

describe("Google Drive backup folder", () => {
  it("finds Google Drive for desktop on its drive letter or in the user's folder", () => {
    const present = new Set(["G:\\My Drive", "C:\\Users\\shop\\Google Drive"]);
    const found = findGoogleDriveFolders({ platform: "win32", home: "C:\\Users\\shop", exists: path => present.has(path) });
    expect(found.map(item => item.folder)).toEqual(["G:\\My Drive\\Billing Backups", "C:\\Users\\shop\\Google Drive\\Billing Backups"]);
  });

  it("suggests nothing when Google Drive for desktop is not installed, and never throws", () => {
    expect(findGoogleDriveFolders({ platform: "win32", home: "C:\\Users\\shop", exists: () => false })).toEqual([]);
    expect(findGoogleDriveFolders({ platform: "win32", home: "C:\\Users\\shop", exists: () => { throw new Error("denied"); } })).toEqual([]);
    expect(findGoogleDriveFolders({ platform: "linux", exists: () => true })).toEqual([]);
  });

  it("recognises a chosen folder inside Google Drive", () => {
    for (const folder of ["G:\\My Drive\\Billing Backups", "C:\\Users\\shop\\Google Drive\\Billing", "g:\\my drive"]) expect(isInGoogleDrive(folder), folder).toBe(true);
    for (const folder of ["D:\\Billing Backups", "E:\\My Drive Backup\\x", "C:\\Users\\shop\\Documents", "", null, undefined]) expect(isInGoogleDrive(folder as string), String(folder)).toBe(false);
  });
});
