import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
const { chooseBackupFolderForSender } = require("../../desktop/backup-folder.cjs");

function sender() {
  const mainFrame = { url: "http://127.0.0.1:3100/" };
  const webContents = { mainFrame };
  return { window: { isDestroyed: () => false, webContents }, event: { sender: webContents, senderFrame: mainFrame } };
}
describe("narrow native backup folder bridge", () => {
  it("selects a folder only for the exact billing window and main frame", async () => {
    const context = sender();
    const dialog = { showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ["D:\\Billing Backups"] }) };
    expect(await chooseBackupFolderForSender({ ...context, args: [], origin: "http://127.0.0.1:3100", dialog })).toBe("D:\\Billing Backups");
    for (const event of [
      { ...context.event, sender: {} },
      { ...context.event, senderFrame: { url: context.event.senderFrame.url } },
    ]) await expect(chooseBackupFolderForSender({ ...context, event, args: [], origin: "http://127.0.0.1:3100", dialog })).rejects.toThrow(/billing window/);
    await expect(chooseBackupFolderForSender({ ...context, args: ["arbitrary path"], origin: "http://127.0.0.1:3100", dialog })).rejects.toThrow(/billing window/);
    for (const url of ["https://evil.example", "http://127.0.0.1:3101", "file:///D:/app", "blob:http://127.0.0.1:3100/id", "http://evil@127.0.0.1:3100/"]) {
      context.event.senderFrame.url = url;
      await expect(chooseBackupFolderForSender({ ...context, args: [], origin: "http://127.0.0.1:3100", dialog })).rejects.toThrow(/sender/);
    }
    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(1);
  });
  it("does not open concurrent dialogs and returns null for cancellation", async () => {
    const context = sender();
    let finish!: (result: unknown) => void;
    const dialog = { showOpenDialog: () => new Promise(resolve => { finish = resolve; }) };
    const first = chooseBackupFolderForSender({ ...context, args: [], origin: "http://127.0.0.1:3100", dialog });
    await expect(chooseBackupFolderForSender({ ...context, args: [], origin: "http://127.0.0.1:3100", dialog })).rejects.toThrow(/already open/);
    finish({ canceled: true, filePaths: [] });
    expect(await first).toBeNull();
  });
  it("exposes no general IPC, filesystem, shell, or caller-supplied arguments", async () => {
    const exposed: Record<string, any> = {};
    const invoke = vi.fn().mockResolvedValue(null);
    runInNewContext(readFileSync(join(process.cwd(), "desktop/preload.cjs"), "utf8"), { require: (module: string) => {
      expect(module).toBe("electron");
      return { contextBridge: { exposeInMainWorld: (name: string, bridge: unknown) => { exposed[name] = bridge; } }, ipcRenderer: { invoke } };
    } });
    expect(Object.keys(exposed)).toEqual(["billingDesktop"]);
    expect(Object.keys(exposed.billingDesktop)).toEqual(["chooseBackupFolder"]);
    await exposed.billingDesktop.chooseBackupFolder("ignored");
    expect(invoke).toHaveBeenCalledWith("billing:choose-backup-folder");
    const main = readFileSync(join(process.cwd(), "desktop/main.cjs"), "utf8");
    expect(main).toMatch(/nodeIntegration: false, contextIsolation: true, sandbox: true/);
  });
});
