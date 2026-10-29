import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { localBillPdfPaths } from "./local-bill-pdfs";

let directory: string;
const billId = "74bb0c44-994d-4231-8067-5f0c9f981509";
const version = "44201913-a01d-4bcb-a1e4-c78a00ed1f36";
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "billing-pdf-cleanup-")); });
afterEach(async () => {
  if (dirname(directory) !== tmpdir().replace(/[\\/]$/, "") || !basename(directory).startsWith("billing-pdf-cleanup-")) throw new Error("Invalid fixture cleanup path");
  await rm(directory, { recursive: true, force: true });
});

describe("local bill PDF versions", () => {
  it("finds original and cached versions only in the owning account", async () => {
    const owned = join(directory, "bill-pdfs", "qa-profile");
    const other = join(directory, "bill-pdfs", "other-profile");
    await mkdir(owned, { recursive: true }); await mkdir(other, { recursive: true });
    const wanted = [`${billId}.pdf`, `${billId}-${version}.pdf`];
    for (const name of [...wanted, `${billId}-notes.pdf`, `${billId}0.pdf`, "other-bill.pdf"]) await writeFile(join(owned, name), "fixture");
    await writeFile(join(other, `${billId}.pdf`), "other account");
    await mkdir(join(owned, `${billId}-94201913-a01d-4bcb-a1e4-c78a00ed1f36.pdf`));
    expect((await localBillPdfPaths("qa-profile", billId, directory)).sort()).toEqual(wanted.map(name => `qa-profile/${name}`).sort());
  });
  it("accepts a bill with no generated PDF directory", async () => {
    expect(await localBillPdfPaths("qa-profile", billId, directory)).toEqual([]);
  });
  it.each([["../other", billId], ["qa-profile", "../other"], ["qa-profile", "bill.*"], ["", billId]])("rejects unsafe account or bill names", async (profile, id) => {
    await expect(localBillPdfPaths(profile, id, directory)).rejects.toThrow("Invalid bill PDF owner");
  });
});
