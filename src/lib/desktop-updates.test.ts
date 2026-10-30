import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { isNewerVersion, readUpdate, sha256, stageUpdate, createUpdateAction } = require("../../desktop/updates.cjs");
const directories: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "billing-updater-"));
  directories.push(root);
  const release = path.join(root, "release");
  await mkdir(release);
  const filename = "Finance-Billing-Setup-1.0.11.exe";
  const installer = path.join(release, filename);
  await writeFile(installer, "synthetic installer; never execute");
  const manifest = { application: "finance-billing-desktop", version: "1.0.11", file: filename, size: Buffer.byteLength("synthetic installer; never execute"), sha256: await sha256(installer) };
  const manifestPath = path.join(release, "latest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { root, installer, manifest, manifestPath };
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
describe("offline desktop updates", () => {
  it("compares versions numerically and refuses malformed versions", () => {
    expect(isNewerVersion("1.0.11", "1.0.9")).toBe(true);
    expect(isNewerVersion("1.1.0", "1.0.99")).toBe(true);
    expect(isNewerVersion("1.0.11", "1.0.11")).toBe(false);
    expect(isNewerVersion("1.0.9", "1.0.11")).toBe(false);
    expect(() => isNewerVersion("1.0.11/evil", "1.0.10")).toThrow();
  });
  it("verifies both size and hash before staging an independent installer", async () => {
    const { root, installer, manifestPath } = await fixture();
    const update = await readUpdate(manifestPath, "1.0.10");
    const staged = await stageUpdate(update, path.join(root, "updates"));
    expect(await readFile(staged, "utf8")).toBe("synthetic installer; never execute");
    await writeFile(installer, "changed");
    expect(await readFile(staged, "utf8")).toBe("synthetic installer; never execute");
    await expect(readUpdate(manifestPath, "1.0.10")).rejects.toThrow("incomplete or has changed");
  });
  it("rejects tampering even when the size is unchanged", async () => {
    const { installer, manifest, manifestPath } = await fixture();
    await writeFile(installer, "x".repeat(manifest.size));
    await expect(readUpdate(manifestPath, "1.0.10")).rejects.toThrow("incomplete or has changed");
  });
  it.each(["../evil.exe", "C:/evil.exe", "https://example.com/setup.exe", "1.0.11/../../evil.exe"])("rejects installer path %s", async file => {
    const { manifest, manifestPath } = await fixture();
    await writeFile(manifestPath, JSON.stringify({ ...manifest, file }));
    await expect(readUpdate(manifestPath, "1.0.10")).rejects.toThrow("not a valid");
  });
  it("does not install older or equal versions", async () => {
    const { manifestPath } = await fixture();
    expect(await readUpdate(manifestPath, "1.0.11")).toBeNull();
    expect(await readUpdate(manifestPath, "2.0.0")).toBeNull();
  });
  it("reads the published version-folder manifest", async () => {
    const { root, installer, manifest, manifestPath } = await fixture();
    const versionDirectory = path.join(root, "release", manifest.version);
    await mkdir(versionDirectory);
    await writeFile(path.join(versionDirectory, path.basename(installer)), await readFile(installer));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, file: `${manifest.version}/${manifest.file}` }));
    expect((await readUpdate(manifestPath, "1.0.10")).installer).toBe(path.join(versionDirectory, manifest.file));
  });
  it("allows choosing a copied update when there is no local release", async () => {
    const { root, manifestPath } = await fixture();
    const app = { isPackaged: true, getVersion: () => "1.0.10", getPath: () => root, quit: vi.fn() };
    const dialog = { showMessageBox: vi.fn().mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 }),
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [manifestPath] }) };
    const launch = vi.fn();
    await createUpdateAction({ app, dialog, getWindow: () => null, dataDirectory: path.join(root, "other-computer", "data"), launch })();
    expect(dialog.showOpenDialog).toHaveBeenCalledOnce();
    expect(dialog.showMessageBox).toHaveBeenLastCalledWith(null, expect.objectContaining({ message: "Install Finance Billing 1.0.11?" }));
    expect(launch).not.toHaveBeenCalled();
  });
  it("keeps the app open when the owner cancels", async () => {
    const { root } = await fixture();
    const app = { isPackaged: true, getVersion: () => "1.0.10", getPath: () => root, quit: vi.fn() };
    const dialog = { showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) };
    const launch = vi.fn();
    await createUpdateAction({ app, dialog, getWindow: () => null, dataDirectory: path.join(root, "data"), launch })();
    expect(launch).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
  });
  it("stages the helper outside asar and launches before quitting", async () => {
    const { root } = await fixture();
    const events: string[] = [];
    const app = { isPackaged: true, getVersion: () => "1.0.10", getPath: () => root, quit: () => events.push("quit") };
    const dialog = { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) };
    const launch = vi.fn(async ({ helper, installer }: { helper: string; installer: string }) => {
      expect(path.dirname(helper)).toBe(path.dirname(installer));
      expect(await readFile(helper, "utf8")).toContain("Get-FileHash");
      events.push("launch");
    });
    await createUpdateAction({ app, dialog, getWindow: () => null, dataDirectory: path.join(root, "data"), launch })();
    expect(events).toEqual(["launch", "quit"]);
  });
  it("keeps billing running and explains a failed helper launch", async () => {
    const { root } = await fixture();
    const app = { isPackaged: true, getVersion: () => "1.0.10", getPath: () => root, quit: vi.fn() };
    const dialog = { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) };
    const launch = vi.fn().mockRejectedValue(new Error("Cannot launch installer"));
    await createUpdateAction({ app, dialog, getWindow: () => null, dataDirectory: path.join(root, "data"), launch })();
    expect(app.quit).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).toHaveBeenLastCalledWith(null, expect.objectContaining({ type: "error", message: "Cannot launch installer" }));
  });
});
