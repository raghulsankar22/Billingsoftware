"use client";
import { useState } from "react";
import type { LocalUser } from "@/lib/local-users";

export async function localAuth(action: string, input: Record<string, unknown> = {}) {
  const response = await fetch("/api/local-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...input }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to complete request.");
  return body;
}
export function LocalSignIn({ setup, onSignedIn, notice }: { setup: boolean; onSignedIn: (user: LocalUser) => void; notice?: string }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setError(""); setBusy(true);
    try { const result = await localAuth(setup ? "setup" : "login", { username, password }); setPassword(""); onSignedIn(result.user); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to sign in."); } finally { setBusy(false); }
  }
  if (forgot && !setup) return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">OFFLINE BILLING</p><h1>Forgot password?</h1><p>Ask your administrator to sign in, open <b>Users</b>, select your username and reset your password.</p><p>If the administrator has forgotten their own password, this offline app cannot reset it automatically.</p><button type="button" onClick={() => setForgot(false)}>Back to sign in</button></section></main>;
  return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">OFFLINE BILLING</p><h1>{setup ? "Create administrator" : "Sign in"}</h1><p>{setup ? "The first user is the administrator and receives the existing business accounts." : "Sign in to open your business accounts."}</p>{notice && <p className="notice" role="status">{notice}</p>}<form onSubmit={submit}>
    <label>Username<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required minLength={3} maxLength={40} /></label>
    <label>Password<input type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} required minLength={8} maxLength={256} /></label>
    {error && <p className="error" role="alert">{error}</p>}<button disabled={busy}>{busy ? "Please wait…" : setup ? "Create administrator" : "Sign in"}</button>
  </form>{!setup && <button type="button" className="text-button forgot-password-button" onClick={() => { setPassword(""); setError(""); setForgot(true); }}>Forgot password?</button>}</section></main>;
}
