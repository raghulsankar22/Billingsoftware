"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { isInGoogleDrive, type DriveSuggestion } from "@/lib/google-drive-path";
import type { BackupCopy, BackupPreview, BackupStatus } from "@/lib/backups";
import { api } from "./api";
import { useLanguage } from "./language-provider";
import { billDraftPrefix } from "@/lib/bill-drafts";

const when = (value: string) => new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Lists the saved copies and, after a clear warning, replaces the current bills with the chosen one. */
function RestoreBackup({ accountSlot, disabled }: { accountSlot: AccountSlot; disabled: boolean }) {
  const { t } = useLanguage();
  const [copies, setCopies] = useState<BackupCopy[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [password, setPassword] = useState("");

  async function open() {
    setError(""); setChosen(""); setConfirming(false);
    try { const loaded = await api("/api/backup-restore", accountSlot); setCopies(loaded.backups); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Backups could not be listed."); }
  }
  async function restore() {
    setBusy(true); setError("");
    try {
      const result = await api("/api/backup-restore", accountSlot, { method: "POST", body: JSON.stringify({ file: chosen, currentPassword: password }) });
      setPassword("");
      try { for (const key of Object.keys(window.localStorage)) if (key.startsWith(billDraftPrefix)) window.localStorage.removeItem(key); } catch { }
      setDone(result.warning || "Recovery completed. Close and reopen the app, then sign in using the restored login details.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The backup could not be restored."); setConfirming(false); }
    finally { setBusy(false); setPassword(""); }
  }

  async function inspect() {
    setBusy(true); setError(""); setPreview(null); setPassword("");
    try {
      const result = await api("/api/backup-restore?file=" + encodeURIComponent(chosen), accountSlot);
      setPreview(result.preview); setConfirming(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The backup could not be verified."); }
    finally { setBusy(false); }
  }

  if (done) return <p className="notice" role="status">{t(done)}</p>;
  if (!copies) return <div className="backup-restore">
    <button type="button" className="secondary" disabled={disabled} onClick={() => void open()}>{t("Restore from a backup")}</button>
    {error && <p className="error" role="alert">{t(error)}</p>}
  </div>;
  const picked = copies.find(copy => copy.file === chosen);
  return <div className="backup-restore" role="group" aria-label={t("Restore from a backup")}>
    <h4>{t("Restore from a backup")}</h4>
    {copies.length === 0 ? <p>{t("There are no backups in the backup folder. Check the drive is connected.")}</p> : <>
      <p className="muted">{t("Choose the backup to go back to.")}</p>
      <ul className="backup-list">{copies.map(copy => <li key={copy.file}><label><input type="radio" name="restore-backup" checked={chosen === copy.file} disabled={busy} onChange={() => { setChosen(copy.file); setConfirming(false); }} />{when(copy.takenAt)} · {(copy.size / 1024 / 1024).toFixed(1)} MB</label></li>)}</ul>
    </>}
    {picked && !confirming && <button type="button" disabled={busy} onClick={() => void inspect()}>{t("Preview this backup")}</button>}
    {picked && confirming && <div className="backup-confirm" role="alert">
      {preview && <div>
        <p><strong>{preview.format === "complete" ? t("Complete installation backup") : t("Legacy single-ledger backup")}</strong> · {when(preview.takenAt)}</p>
        <p>{t("Businesses")}: {preview.businesses.join(", ") || t("None")} · {t("Users")}: {preview.userCount} · {t("Bills")}: {preview.billCount} · {t("Customers")}: {preview.customerCount}</p>
      </div>}
      <p><strong>{preview?.format === "legacy" ? t("Legacy recovery replaces only the main ledger. Other users, documents and settings are not restored.") : t("This replaces all users, businesses, passwords, settings and stored documents with this backup.")}</strong> {t("A complete safety backup is kept first. Everyone must sign in again after restarting the app.")}</p>
      <label>{t("Current administrator password")}<input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
      <div className="backup-actions">
        <button type="button" className="danger" disabled={busy || !password || !preview} onClick={() => void restore()}>{busy ? t("Restoring…") : t("Yes, restore this backup")}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setConfirming(false)}>{t("Cancel")}</button>
      </div>
    </div>}
    {!confirming && <button type="button" className="text-button" disabled={busy} onClick={() => { setCopies(null); setChosen(""); setError(""); }}>{t("Close")}</button>}
    {error && <p className="error" role="alert">{t(error)}</p>}
  </div>;
}

/** Home-screen safety check: shows the last backup, makes a daily copy, and lets the owner back up now. */
export function BackupPanel({ accountSlot }: { accountSlot: AccountSlot }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [folder, setFolder] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [administrator, setAdministrator] = useState(false);
  const [driveFolders, setDriveFolders] = useState<DriveSuggestion[]>([]);

  const run = useCallback(async (method: "POST" | "PUT", body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try { setStatus(await api("/api/backup", accountSlot, { method, body: JSON.stringify(body) })); setEditing(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Backup could not be completed."); }
    finally { setBusy(false); }
  }, [accountSlot]);

  useEffect(() => {
    let current = true;
    api("/api/backup", accountSlot).then((loaded: BackupStatus & { administrator?: boolean; googleDrive?: DriveSuggestion[] }) => {
      if (!current) return;
      setStatus(loaded); setFolder(loaded.folder ?? "");
      setAdministrator(loaded.administrator === true); setDriveFolders(loaded.googleDrive ?? []);
      if (loaded.due) void run("POST", { auto: true });
    }).catch(failure => { if (current) setError(failure instanceof Error ? failure.message : "Backup status could not be loaded."); });
    return () => { current = false; };
  }, [accountSlot, run]);

  if (!status && !error) return null;
  const stale = Boolean(status?.folder) && (status?.due ?? false);
  const choosing = editing || !status?.folder;
  return <section className={`panel backup-panel${!status?.folder || stale || error ? " backup-warning" : ""}`} aria-label={t("Data backup")}>
    <div className="backup-summary">
      <div>
        <h3>{t("Data backup")}</h3>
        {!status?.folder && <p>{t("Not backed up yet. Choose a folder on a USB drive or another disk to keep a safe copy of all bills.")}</p>}
        {status?.folder && status.lastBackupAt && <p>{t("Last backup:")} <strong>{when(status.lastBackupAt)}</strong> · {t("Copies kept:")} {status.copies} · {t("Folder:")} {status.folder}</p>}
        {status?.folder && !status.lastBackupAt && <p>{t("No backup has been made yet.")}</p>}
        {stale && !busy && !error && <p className="muted">{t("The last backup is more than a day old.")}</p>}
      </div>
      {status?.folder && <div className="backup-actions">
        <button type="button" disabled={busy} onClick={() => void run("POST", {})}>{busy ? t("Backing up…") : t("Back up now")}</button>
        {administrator && !editing && <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(true)}>{t("Change folder")}</button>}
      </div>}
    </div>
    {choosing && administrator && <form className="backup-folder" onSubmit={event => { event.preventDefault(); void run("PUT", { folder }); }}>
      <button type="button" className="secondary" disabled={busy} onClick={async () => {
        const bridge = (window as Window & { billingDesktop?: { chooseBackupFolder: () => Promise<string | null> } }).billingDesktop;
        if (!bridge) { setError("In the website, enter the full folder path below. The desktop app also supports a native folder chooser."); return; }
        try { const selected = await bridge.chooseBackupFolder(); if (selected) setFolder(selected); }
        catch { setError("The folder chooser could not be opened. Enter the full path below."); }
      }}>{t("Choose folder…")}</button>
      <label>{t("Backup folder")}<input value={folder} placeholder="D:\Billing Backups" disabled={busy} maxLength={400} onChange={event => setFolder(event.target.value)} /></label>
      {driveFolders.map(item => <button type="button" className="secondary" key={item.folder} disabled={busy} onClick={() => setFolder(item.folder)}>{t("Use Google Drive")}: {item.folder}</button>)}
      <button disabled={busy || !folder.trim()}>{busy ? t("Backing up…") : t("Save folder and back up")}</button>
      {status?.folder && <button type="button" className="secondary" disabled={busy} onClick={() => { setEditing(false); setFolder(status.folder ?? ""); setError(""); }}>{t("Cancel")}</button>}
    </form>}
    {choosing && administrator && driveFolders.length === 0 && !isInGoogleDrive(folder) && <p className="muted">{t("To keep copies online, install Google Drive for desktop (free) and sign in, then choose a folder inside My Drive. Each copy uploads automatically.")}</p>}
    {status?.folder && isInGoogleDrive(status.folder) && !choosing && <p className="muted">{t("This folder is in Google Drive, so each copy also uploads to your Google account once Google Drive for desktop has synced it.")}</p>}
    {error && <p className="error" role="alert">{t(error)}</p>}
    {status?.folder && !error && status.lastError && <p className="error" role="alert">{t(status.lastError)}</p>}
    {status?.folder && !choosing && administrator && <RestoreBackup accountSlot={accountSlot} disabled={busy} />}
    <p className="muted backup-note">{t("Complete backups keep all users, businesses, bills, customers, passwords, settings and stored documents. They are not encrypted: protect the backup drive and keep it away from this computer. An administrator chooses the backup folder and restores data.")}</p>
  </section>;
}
