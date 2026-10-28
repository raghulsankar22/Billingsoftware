"use client";

import { useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { api } from "./api";
import { localStorageEnabled } from "@/lib/storage-mode";

type Profile = { business_name: string; address: string; phone: string; logo_url?: string | null; next_bill_number: number };
export function ProfileForm({ profile, accountSlot, onSaved }: { profile: Profile | null; accountSlot: AccountSlot; onSaved: () => void }) {
  const [form, setForm] = useState({ businessName: profile?.business_name ?? "", address: profile?.address ?? "", phone: profile?.phone ?? "", logoUrl: profile?.logo_url ?? "", nextBillNumber: profile?.next_bill_number ?? 1 });
  const [message, setMessage] = useState("");
  const set = (key: keyof typeof form, value: string | number) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    try { await api("/api/profile", accountSlot, { method: "POST", body: JSON.stringify(form) }); setMessage("Business profile saved."); onSaved(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save profile."); }
  }
  return <section className="panel"><div className="section-heading"><div><p className="eyebrow">ACCOUNT {accountSlot} SETUP</p><h2>Business profile</h2><p className="muted">Name, contact details, logo and bill numbering are saved separately for each account.</p></div></div><form className="form-grid" onSubmit={submit}><label>Business name<input value={form.businessName} onChange={(e) => set("businessName", e.target.value)} required /></label><label>Phone<input value={form.phone} onChange={(e) => set("phone", e.target.value)} required /></label><label className="wide">Business address<textarea value={form.address} onChange={(e) => set("address", e.target.value)} required /></label><label>Logo image URL <span className="muted">optional</span><input value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} /></label><label>{localStorageEnabled ? "Next bill number" : "First bill number"}<input type="number" min="1" value={form.nextBillNumber} onChange={(e) => set("nextBillNumber", Number(e.target.value))} readOnly={localStorageEnabled} required />{localStorageEnabled && <span className="muted">Empty accounts always start at bill 1.</span>}</label><div className="wide form-actions"><button>Save profile</button>{message && <span className="notice">{message}</span>}</div></form></section>;
}
