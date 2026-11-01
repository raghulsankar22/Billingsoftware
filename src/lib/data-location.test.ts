import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { resolveDataDirectory } = require("../../desktop/data-location.cjs");
const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function setup() {
  const root = mkdtempSync(join(tmpdir(), "billing-location-")); folders.push(root);
  const paths = { settingsFile: join(root, "profile", "data-location.json"), legacyDirectory: join(root, "drive", "app", "data"), defaultDirectory: join(root, "profile", "data") };
  return paths;
}
const addLedger = (directory: string) => { mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "billing.sqlite"), ""); };

describe("billing data location", () => {
  it("keeps using the existing D: ledger and remembers it", () => {
    const paths = setup(); addLedger(paths.legacyDirectory);
    expect(resolveDataDirectory(paths)).toBe(paths.legacyDirectory);
    expect(JSON.parse(readFileSync(paths.settingsFile, "utf8")).dataDirectory).toBe(paths.legacyDirectory);
  });
  it("finds a ledger in the app folder when D: has none", () => {
    const paths = setup(); addLedger(paths.defaultDirectory); mkdirSync(paths.legacyDirectory, { recursive: true });
    expect(resolveDataDirectory(paths)).toBe(paths.defaultDirectory);
  });
  it("uses the app folder on a new installation even if a D: drive exists", () => {
    const paths = setup(); mkdirSync(paths.legacyDirectory, { recursive: true });
    expect(resolveDataDirectory(paths)).toBe(paths.defaultDirectory);
  });
  it("doesn't move to a ledger that appears on another drive later", () => {
    const paths = setup(); addLedger(paths.defaultDirectory);
    resolveDataDirectory(paths);
    addLedger(paths.legacyDirectory);
    expect(resolveDataDirectory(paths)).toBe(paths.defaultDirectory);
  });
  it("stops with a clear message when the saved folder is missing, creating nothing", () => {
    const paths = setup(); addLedger(paths.legacyDirectory);
    resolveDataDirectory(paths);
    rmSync(paths.legacyDirectory, { recursive: true });
    expect(() => resolveDataDirectory(paths)).toThrow("was not found");
    expect(() => readFileSync(join(paths.defaultDirectory, "billing.sqlite"))).toThrow();
    expect(() => readFileSync(join(paths.legacyDirectory, "billing.sqlite"))).toThrow();
  });
  it("refuses an unreadable saved location instead of guessing", () => {
    const paths = setup(); mkdirSync(join(paths.settingsFile, ".."), { recursive: true }); writeFileSync(paths.settingsFile, "not json");
    expect(() => resolveDataDirectory(paths)).toThrow("could not be read");
  });
});
