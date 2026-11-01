"use client";

import { useLanguage } from "./language-provider";
import { PasswordInput } from "./password-input";
import { useState } from "react";
import type { LocalUser } from "@/lib/local-users";

export async function localAuth(action: string, input: Record<string, unknown> = {}) {
  const response = await fetch("/api/local-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...input }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to complete request.");
  return body;
}
export function LocalSignIn({ setup, onSignedIn, notice }: { setup: boolean; onSignedIn: (user: LocalUser) => void; notice?: string }) {
  const { t } = useLanguage();
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [creating, setCreating] = useState(false);
  const [adminUsername, setAdminUsername] = useState(""); const [adminPassword, setAdminPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [createdNotice, setCreatedNotice] = useState("");
  function leaveCreate() { setAdminUsername(""); setAdminPassword(""); setPassword(""); setConfirm(""); setError(""); setCreating(false); }
  async function createUser(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    if (password !== confirm) { setError("New passwords do not match."); return; }
    setError(""); setBusy(true);
    try {
      const result = await localAuth("create-with-admin", { adminUsername, adminPassword, username, password });
      setUsername(result.username); setCreatedNotice(`User ${result.username} created. Sign in with the new password.`); leaveCreate();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to create user."); } finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setError(""); setBusy(true);
    try { const result = await localAuth(setup ? "setup" : "login", { username, password }); setPassword(""); onSignedIn(result.user); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to sign in."); } finally { setBusy(false); }
  }
  if (forgot && !setup) return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">{t("OFFLINE BILLING")}</p><h1>{t("Forgot password?")}</h1><p>{t("Ask your administrator to sign in, open")} <b>{t("Users")}</b>{t(", select your username and reset your password.")}</p><p>{t("If the administrator has forgotten their own password, this offline app cannot reset it automatically.")}</p><button type="button" onClick={() => setForgot(false)}>{t("Back to sign in")}</button></section></main>;
  if (creating && !setup) return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">{t("OFFLINE BILLING")}</p><h1>{t("Create new user")}</h1><p>{t("An administrator must approve every new user. Each user has separate business accounts and bills.")}</p><form onSubmit={createUser}>
    <label>{t("Administrator username")}<input autoComplete="off" value={adminUsername} onChange={event => setAdminUsername(event.target.value)} required minLength={3} maxLength={40} /></label>
    <label>{t("Administrator password")}<PasswordInput autoComplete="off" value={adminPassword} onChange={event => setAdminPassword(event.target.value)} required maxLength={256} /></label>
    <label>{t("New username")}<input autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} required minLength={3} maxLength={40} /></label>
    <label>{t("New password")}<PasswordInput autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={8} maxLength={256} /></label>
    <label>{t("Confirm new password")}<PasswordInput autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} required minLength={8} maxLength={256} /></label>
    {error && <p className="error" role="alert">{t(error)}</p>}<button disabled={busy}>{busy ? t("Please wait…") : t("Create user")}</button>
  </form><button type="button" className="text-button forgot-password-button" onClick={leaveCreate}>{t("Back to sign in")}</button></section></main>;
  return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">{t("OFFLINE BILLING")}</p><h1>{setup ? t("Create administrator") : t("Sign in")}</h1><p>{setup ? t("The first user is the administrator and receives the existing business accounts.") : t("Sign in to open your business accounts.")}</p>{(createdNotice || notice) && <p className="notice" role="status">{t(createdNotice || notice || "")}</p>}<form onSubmit={submit}>
    <label>{t("Username")}<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required minLength={3} maxLength={40} /></label>
    <label>{t("Password")}<PasswordInput autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} required minLength={8} maxLength={256} /></label>
    {error && <p className="error" role="alert">{t(error)}</p>}<button disabled={busy}>{busy ? t("Please wait…") : setup ? t("Create administrator") : t("Sign in")}</button>
  </form>{!setup && <button type="button" className="text-button forgot-password-button" onClick={() => { setPassword(""); setError(""); setForgot(true); }}>{t("Forgot password?")}</button>}{!setup && <button type="button" className="text-button forgot-password-button" onClick={() => { setPassword(""); setError(""); setCreatedNotice(""); setCreating(true); }}>{t("Create new user")}</button>}</section></main>;
}
