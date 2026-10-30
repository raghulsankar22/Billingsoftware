"use client";
import { useEffect, useState } from "react";
import type { LocalUser } from "@/lib/local-users";
import { localAuth } from "./local-sign-in";

export function LocalUserManagement({ currentUser, onSignedOut }: { currentUser: LocalUser; onSignedOut: () => void }) {
  const [users, setUsers] = useState<LocalUser[]>([]); const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  const [resetId, setResetId] = useState(""); const [resetPassword, setResetPassword] = useState("");
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; localAuth("list").then(result => { if (active) setUsers(result.users); }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, []);
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { const result = await localAuth("create", { username, password }); setUsers(result.users); setUsername(""); setPassword(""); setMessage("User created. They can sign in and set up their own accounts."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to create user."); } finally { setBusy(false); }
  }
  async function reset(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { await localAuth("reset", { userId: resetId, password: resetPassword }); setResetPassword(""); if (resetId === currentUser.id) onSignedOut(); else setMessage("Password reset. The user must sign in again."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to reset password."); } finally { setBusy(false); }
  }
  return <section className="panel"><h2>Manage users</h2><p className="muted">Each user has separate business accounts and customer records.</p>
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    <h3>Create user</h3><form className="form-grid" onSubmit={create}><label>Username<input required minLength={3} maxLength={40} value={username} autoComplete="off" onChange={event => setUsername(event.target.value)} /></label><label>New password<input type="password" required minLength={8} maxLength={256} value={password} autoComplete="new-password" onChange={event => setPassword(event.target.value)} /></label><button disabled={busy}>Create user</button></form>
    <h3>Reset a password</h3><form className="form-grid" onSubmit={reset}><label>User<select required value={resetId} onChange={event => setResetId(event.target.value)}><option value="">Choose user</option>{users.map(user => <option key={user.id} value={user.id}>{user.username}{user.administrator ? " (administrator)" : ""}</option>)}</select></label><label>New password<input type="password" required minLength={8} maxLength={256} value={resetPassword} autoComplete="new-password" onChange={event => setResetPassword(event.target.value)} /></label><button disabled={busy}>Reset password</button></form>
  </section>;
}
