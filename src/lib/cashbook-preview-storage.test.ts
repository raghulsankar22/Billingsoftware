import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isCashBookPreviewStorage, assertCashBookPreviewStorage } from "./cashbook-preview-storage";
import { baseDataDirectory } from "./local-session-context";

let root: string | undefined;
afterEach(() => { vi.unstubAllEnvs(); if (root) { rmSync(root, { recursive: true, force: true }); root = undefined; } });
describe("isolated cash-book demonstration", () => {
  it("fails closed instead of falling back to live data", () => {
    vi.stubEnv("BILLING_CASHBOOK_PREVIEW", "1"); vi.stubEnv("LOCAL_DATA_DIR", "");
    expect(isCashBookPreviewStorage()).toBe(false); expect(assertCashBookPreviewStorage).toThrow(); expect(baseDataDirectory).toThrow();
    vi.stubEnv("LOCAL_DATA_DIR", resolve("data")); expect(isCashBookPreviewStorage()).toBe(false); expect(baseDataDirectory).toThrow();
  });
  it("refuses unsafe preview and seed launch configuration", () => {
    const run = (script: string, env: Record<string, string>) => execFileSync(process.execPath, [script], { env: { ...process.env, ...env }, stdio: "pipe" });
    expect(() => run("scripts/preview-website.mjs", { BILLING_PREVIEW_PORT: "3110", LOCAL_DATA_DIR: "" })).toThrow();
    expect(() => run("scripts/start-cashbook-preview.mjs", { LOCAL_DATA_DIR: resolve("data") })).toThrow();
    expect(() => run("scripts/seed-cashbook-demo.cjs", { LOCAL_DATA_DIR: resolve("data") })).toThrow();
    expect(() => run("scripts/preview-website.mjs", { BILLING_CASHBOOK_PREVIEW: "1", BILLING_PREVIEW_PORT: "3101", LOCAL_DATA_DIR: resolve("data") })).toThrow();
  });
  it("requires the exact sample path and filesystem marker", () => {
    root = mkdtempSync(join(tmpdir(), "billing-cash-preview-")); const sample = join(root, "tmp", "cashbook-website-demo"); mkdirSync(sample, { recursive: true });
    const moduleUrl = pathToFileURL(resolve("scripts/cashbook-preview-safety.mjs")).href;
    const check = (configured?: string) => execFileSync(process.execPath, ["--input-type=module", "-e", "import {verifyCashBookPreviewDirectory as check} from " + JSON.stringify(moduleUrl) + "; check(" + JSON.stringify(root) + "," + JSON.stringify(configured) + ")"], { stdio: "pipe" });
    expect(() => check()).toThrow(); expect(() => check(join(root!, "data"))).toThrow(); expect(() => check(sample)).toThrow();
    writeFileSync(join(sample, ".cashbook-demo"), "wrong"); expect(() => check(sample)).toThrow();
    writeFileSync(join(sample, ".cashbook-demo"), "synthetic-cashbook-preview-v1"); expect(() => check(sample)).not.toThrow();
  });
});

