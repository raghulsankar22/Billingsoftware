"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import type { BackupCopy, BackupStatus } from "@/lib/backups";
import { api } from "./api";
import { useLanguage } from "./language-provider";

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

  async function open() {
    setError(""); setChosen(""); setConfirming(false);
    try { const loaded = await api("/api/backup-restore", accountSlot); setCopies(loaded.backups); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Backups could not be listed."); }
  }
  async function restore() {
    setBusy(true); setError("");
    try {
      const result = await api("/api/backup-restore", accountSlot, { method: "POST", body: JSON.stringify({ file: chosen }) });
      setDone(result.warning || "Your bills were restored from the backup. The page will reload.");
      setTimeout(() => window.location.reload(), 2500);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The backup could not be restored."); setConfirming(false); }
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
    {picked && !confirming && <button type="button" disabled={busy} onClick={() => setConfirming(true)}>{t("Restore this backup")}</button>}
    {picked && confirming && <div className="backup-confirm" role="alert">
      <p><strong>{t("This replaces ALL current bills and customers with the backup from")} {when(picked.takenAt)}.</strong> {t("Anything saved after that time will be removed from the app. A safety copy of the current bills is kept first.")}</p>
      <div className="backup-actions">
        <button type="button" className="danger" disabled={busy} onClick={() => void restore()}>{busy ? t("Restoring…") : t("Yes, replace my bills")}</button>
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

  const run = useCallback(async (method: "POST" | "PUT", body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try { setStatus(await api("/api/backup", accountSlot, { method, body: JSON.stringify(body) })); setEditing(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Backup could not be completed."); }
    finally { setBusy(false); }
  }, [accountSlot]);

  useEffect(() => {
    let current = true;
    api("/api/backup", accountSlot).then((loaded: BackupStatus) => {
      if (!current) return;
      setStatus(loaded); setFolder(loaded.folder ?? "");
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
        {!editing && <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(true)}>{t("Change folder")}</button>}
      </div>}
    </div>
    {choosing && <form className="backup-folder" onSubmit={event => { event.preventDefault(); void run("PUT", { folder }); }}>
      <label>{t("Backup folder")}<input value={folder} placeholder="D:\Billing Backups" disabled={busy} maxLength={400} onChange={event => setFolder(event.target.value)} /></label>
      <button disabled={busy || !folder.trim()}>{busy ? t("Backing up…") : t("Save folder and back up")}</button>
      {status?.folder && <button type="button" className="secondary" disabled={busy} onClick={() => { setEditing(false); setFolder(status.folder ?? ""); setError(""); }}>{t("Cancel")}</button>}
    </form>}
    {error && <p className="error" role="alert">{t(error)}</p>}
    {status?.folder && !error && status.lastError && <p className="error" role="alert">{t(status.lastError)}</p>}
    {status?.folder && !choosing && <RestoreBackup accountSlot={accountSlot} disabled={busy} />}
    <p className="muted backup-note">{t("Backups keep the bills and customers database. Keep the backup drive somewhere other than this computer.")}</p>
  </section>;
}
