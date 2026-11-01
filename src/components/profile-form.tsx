"use client";

import { useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { api } from "./api";
import { extendedAccounts } from "@/lib/storage-mode";

type Profile = { business_name: string; address: string; phone: string; logo_url?: string | null; license_number?: string | null; next_bill_number: number };
export function ProfileForm({ profile, accountSlot, onSaved, creatingAccount = false, onCancel }: { profile: Profile | null; accountSlot: AccountSlot; onSaved: (savedSlot?: AccountSlot) => void; creatingAccount?: boolean; onCancel?: () => void }) {
  const [form, setForm] = useState({ businessName: profile?.business_name ?? "", address: profile?.address ?? "", phone: profile?.phone ?? "", logoUrl: profile?.logo_url ?? "", licenseNumber: profile?.license_number ?? "", nextBillNumber: profile?.next_bill_number ?? 1 });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const set = (key: keyof typeof form, value: string | number) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage(""); setFailed(false);
    try { const result = await api(creatingAccount ? "/api/accounts" : "/api/profile", accountSlot, { method: "POST", body: JSON.stringify(form) }); setMessage(creatingAccount ? "Business account created." : "Business profile saved."); onSaved(result.profile?.account_slot ?? accountSlot); }
    catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Unable to save profile."); }
    finally { setBusy(false); }
  }
  return <section className="panel"><form onSubmit={submit}>
    <div className="section-heading profile-form-heading"><div><p className="eyebrow">{creatingAccount ? "NEW BUSINESS ACCOUNT" : `ACCOUNT ${accountSlot} SETUP`}</p><h2>{creatingAccount ? "Add new account" : "Business profile"}</h2><p className="muted">Name, contact details, license number, logo and bill numbering are saved separately for each account.</p></div><label className="profile-license-field"><span>License number <span className="muted">(optional)</span></span><input value={form.licenseNumber} disabled={busy} maxLength={80} onChange={(e) => set("licenseNumber", e.target.value)} /></label></div>
    <div className="form-grid"><label>Business name<input value={form.businessName} autoFocus={creatingAccount} disabled={busy} minLength={2} maxLength={160} onChange={(e) => set("businessName", e.target.value)} required /></label><label>Phone<input value={form.phone} disabled={busy} minLength={7} maxLength={20} onChange={(e) => set("phone", e.target.value)} required /></label><label className="wide">Business address<textarea value={form.address} disabled={busy} minLength={5} maxLength={500} onChange={(e) => set("address", e.target.value)} required /></label><label>Logo image URL <span className="muted">optional</span><input value={form.logoUrl} disabled={busy} onChange={(e) => set("logoUrl", e.target.value)} /></label><label>{extendedAccounts ? "Next bill number" : "First bill number"}<input type="number" min="1" disabled={busy} value={form.nextBillNumber} onChange={(e) => set("nextBillNumber", Number(e.target.value))} readOnly={extendedAccounts} required />{extendedAccounts && <span className="muted">Empty accounts always start at bill 1.</span>}</label><div className="wide form-actions"><button disabled={busy}>{busy ? "Saving…" : creatingAccount ? "Create account" : "Save profile"}</button>{onCancel && <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>}{message && <span className={failed ? "error" : "notice"} role={failed ? "alert" : "status"}>{message}</span>}</div></div>
  </form></section>;
}
