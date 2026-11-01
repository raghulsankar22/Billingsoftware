"use client";

import { useLanguage } from "./language-provider";
import { PasswordInput } from "./password-input";
import { useState } from "react";
import type { LocalUser } from "@/lib/local-users";
import { localAuth } from "./local-sign-in";

export function LocalMyAccount({ user, onChanged }: { user: LocalUser; onChanged: () => void }) {
  const { t } = useLanguage();
  const [currentPassword, setCurrentPassword] = useState(""); const [newPassword, setNewPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setError("");
    if (newPassword !== confirm) { setError("The new passwords do not match."); return; }
    setBusy(true);
    try { await localAuth("change-password", { currentPassword, newPassword }); setCurrentPassword(""); setNewPassword(""); setConfirm(""); onChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to change password."); } finally { setBusy(false); }
  }
  return <section className="panel"><h2>{t("My account")}</h2><p>{t("Username:")} <b>{user.username}</b>{user.administrator && " · Administrator"}</p><h3>{t("Change password")}</h3><p className="muted">{t("After changing your password, sign in again with the new password.")}</p><form className="form-grid" onSubmit={submit}>
    <label>{t("Current password")}<PasswordInput autoComplete="current-password" required value={currentPassword} onChange={event => { setCurrentPassword(event.target.value); setError(""); }} /></label>
    <label>{t("New password")}<PasswordInput autoComplete="new-password" minLength={8} maxLength={256} required value={newPassword} onChange={event => { setNewPassword(event.target.value); setError(""); }} /></label>
    <label>{t("Confirm new password")}<PasswordInput autoComplete="new-password" minLength={8} maxLength={256} required value={confirm} onChange={event => { setConfirm(event.target.value); setError(""); }} /></label>
    {error && <p className="error wide" role="alert">{t(error)}</p>}<button disabled={busy}>{busy ? t("Saving…") : t("Change password")}</button>
  </form></section>;
}
