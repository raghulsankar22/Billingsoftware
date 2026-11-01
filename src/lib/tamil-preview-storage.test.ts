import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isTamilPreviewStorage, assertTamilPreviewStorage } from "./tamil-preview-storage";
import { baseDataDirectory } from "./local-session-context";

let root: string | undefined;
afterEach(() => {
  vi.unstubAllEnvs();
  if (root) {
    if (dirname(root) !== tmpdir().replace(/[\/]$/, "") || !basename(root).startsWith("billing-tamil-safety-")) throw new Error("Unsafe fixture cleanup");
    rmSync(root, { recursive: true, force: true }); root = undefined;
  }
});

describe("isolated Tamil preview", () => {
  it("never falls back to the real ledger when preview configuration is absent or wrong", () => {
    vi.stubEnv("BILLING_TAMIL_PREVIEW", "1"); vi.stubEnv("LOCAL_DATA_DIR", "");
    expect(isTamilPreviewStorage()).toBe(false); expect(assertTamilPreviewStorage).toThrow(); expect(baseDataDirectory).toThrow();
    vi.stubEnv("LOCAL_DATA_DIR", resolve("data")); expect(isTamilPreviewStorage()).toBe(false); expect(baseDataDirectory).toThrow();
  });
  it("refuses unsafe launch configuration before starting Next", () => {
    expect(() => execFileSync(process.execPath, ["scripts/preview-website.mjs"], { env: { ...process.env, BILLING_PREVIEW_PORT: "3103", LOCAL_DATA_DIR: "" }, stdio: "pipe" })).toThrow();
    expect(() => execFileSync(process.execPath, ["scripts/start-tamil-preview.mjs"], { env: { ...process.env, LOCAL_DATA_DIR: resolve("data") }, stdio: "pipe" })).toThrow();
  });
  it("requires the exact sample directory and marker, not merely a public flag", () => {
    root = mkdtempSync(join(tmpdir(), "billing-tamil-safety-"));
    const sample = join(root, "tmp", "tamil-website-demo");
    mkdirSync(sample, { recursive: true });
    const moduleUrl = pathToFileURL(resolve("scripts/tamil-preview-safety.mjs")).href;
    const check = (configured?: string) => execFileSync(process.execPath, ["--input-type=module", "-e", "import {verifyTamilPreviewDirectory as check} from " + JSON.stringify(moduleUrl) + "; check(" + JSON.stringify(root) + "," + JSON.stringify(configured) + ")"], { stdio: "pipe" });
    expect(() => check()).toThrow(); expect(() => check(join(root!, "data"))).toThrow(); expect(() => check(sample)).toThrow();
    writeFileSync(join(sample, ".tamil-demo"), "wrong"); expect(() => check(sample)).toThrow();
    writeFileSync(join(sample, ".tamil-demo"), "synthetic-tamil-preview-v1"); expect(() => check(sample)).not.toThrow();
  });
});
