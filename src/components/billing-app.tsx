"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { withAccountSlot } from "@/lib/account-url";
import type { Bill } from "@/lib/types";
import { formatINR } from "@/lib/money";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { api, requestHeaders } from "./api";
import { localStorageEnabled } from "@/lib/storage-mode";
import { BillDocument } from "./bill-document";
import { BillForm } from "./bill-form";
import { ProfileForm } from "./profile-form";
import { SignIn } from "./sign-in";

type Profile = {
  id?: string;
  account_slot: AccountSlot;
  business_name: string;
  address: string;
  phone: string;
  logo_url?: string | null;
  next_bill_number: number;
};

const ACCOUNT_SLOTS: AccountSlot[] = [1, 2, 3];
const ACCOUNT_STORAGE_KEY = "finance-billing-selected-account";

function accountLabel(slot: AccountSlot, profiles: Profile[]) {
  const profile = profiles.find((candidate) => Number(candidate.account_slot) === slot);
  return profile?.business_name ? `Account ${slot} · ${profile.business_name}` : `Account ${slot} · set up business`;
}

function safeFilenamePart(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim() || "Business";
}

export function BillingApp() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [accountSlot, setAccountSlot] = useState<AccountSlot>(1);
  const [accountReady, setAccountReady] = useState(false);
  const [loadedSlot, setLoadedSlot] = useState<AccountSlot | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"dashboard" | "new" | "settings">("dashboard");
  const [selected, setSelected] = useState<Bill | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [replacementSource, setReplacementSource] = useState<Bill | null>(null);
  const loadGeneration = useRef(0);
  const configured = localStorageEnabled || Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  useEffect(() => {
    if (localStorageEnabled) {
      setSignedIn(true);
    } else if (configured) {
      createBrowserSupabase().auth.getSession()
        .then(({ data }) => setSignedIn(Boolean(data.session)))
        .catch(() => setSignedIn(false));
    }
  }, [configured]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ACCOUNT_STORAGE_KEY);
      if (saved === "1" || saved === "2" || saved === "3") setAccountSlot(Number(saved) as AccountSlot);
    } catch {
      // The selector still works for this session when browser storage is unavailable.
    }
    setAccountReady(true);
  }, []);

  useEffect(() => {
    if (!accountReady) return;
    try {
      window.localStorage.setItem(ACCOUNT_STORAGE_KEY, String(accountSlot));
    } catch {
      // Selection persistence is optional; requests always use the current account state.
    }
  }, [accountReady, accountSlot]);

  async function load(search = "", slot: AccountSlot = accountSlot) {
    const generation = ++loadGeneration.current;
    setIsLoading(true);
    try {
      const [profileResult, billsResult] = await Promise.all([
        api("/api/profile", slot),
        api(`/api/bills${search ? `?q=${encodeURIComponent(search)}` : ""}`, slot),
      ]);
      if (generation !== loadGeneration.current) return;
      setProfile(profileResult.profile ?? null);
      setProfiles(profileResult.profiles ?? []);
      setBills(billsResult.bills ?? []);
      setLoadedSlot(slot);
      setError("");
    } catch (failure) {
      if (generation === loadGeneration.current) setError(failure instanceof Error ? failure.message : "Unable to load billing data.");
    } finally {
      if (generation === loadGeneration.current) setIsLoading(false);
    }
  }

  useEffect(() => {
    if (signedIn && accountReady) void load(query, accountSlot);
  }, [signedIn, accountReady, accountSlot]);

  if (!configured) return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">ONE-TIME SETUP REQUIRED</p><h1>Finance Billing</h1><p>The app is installed correctly, but needs its secure cloud database details before it can accept bills.</p><ol className="setup-steps"><li>Create a Supabase project.</li><li>Apply all SQL files in <code>supabase/migrations</code> in order (001–004, then the Google Drive migration).</li><li>Copy <code>.env.example</code> to <code>.env.local</code> and add the Supabase URL, anon key, and server service-role key.</li><li>Restart this server.</li></ol><p className="notice">Your Google Drive details can be added after this first setup.</p></section></main>;
  if (signedIn === null || !accountReady) return <main className="auth-shell"><p>Loading secure billing…</p></main>;
  if (!signedIn) return <SignIn onSignedIn={() => setSignedIn(true)} />;

  function selectAccount(value: string) {
    const selectedSlot = Number(value);
    if (!ACCOUNT_SLOTS.includes(selectedSlot as AccountSlot) || selectedSlot === accountSlot) return;
    if (view === "new" && !window.confirm("Switch accounts? Unsaved bill details will be discarded.")) return;

    setAccountSlot(selectedSlot as AccountSlot);
    setLoadedSlot(null);
    setProfile(null);
    setBills([]);
    setQuery("");
    setSelected(null);
    setReplacementSource(null);
    setView("dashboard");
    setError("");
  }

  const issueSuccess = (bill: Bill) => {
    setReplacementSource(null);
    setSelected(bill);
    setView("dashboard");
    void load(query, accountSlot);
  };

  async function exportExcel() {
    try {
      const response = await fetch(withAccountSlot("/api/reports/excel", accountSlot), { headers: await requestHeaders() });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Excel export failed.");
      }
      const link = document.createElement("a");
      const business = safeFilenamePart(profile?.business_name || `Account ${accountSlot}`);
      link.href = URL.createObjectURL(await response.blob());
      link.download = `Finance Billing - ${business} - Account ${accountSlot}.xlsx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to export Excel.");
    }
  }

  async function voidBill(id: string) {
    if (!window.confirm("Void this bill? It will remain in history and cannot be edited.")) return;
    try {
      await api(`/api/bills/${id}/void`, accountSlot, { method: "POST" });
      await load(query, accountSlot);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to void bill.");
    }
  }

  async function retryExcel(id: string) {
    try {
      await api(`/api/bills/${id}/retry-excel`, accountSlot, { method: "POST" });
      await load(query, accountSlot);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to retry the Excel register update.");
    }
  }

  async function connectGoogleDrive() {
    try {
      const { url } = await api("/api/google-drive/connect", accountSlot, { method: "POST" });
      window.location.assign(url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to connect Google Drive.");
    }
  }

  const accountLoaded = loadedSlot === accountSlot;

  return <main className="app-shell">
    <header className="topbar">
      <div className="topbar-brand">
        <div>
          <p className="eyebrow">FINANCE BILLING</p>
          <h1>{accountLoaded ? profile?.business_name || `Account ${accountSlot}` : `Account ${accountSlot}`}</h1>
        </div>
        <div className="account-picker">
          <label htmlFor="business-account">Business account</label>
          <select id="business-account" value={accountSlot} onChange={(event) => selectAccount(event.target.value)}>
            {ACCOUNT_SLOTS.map((slot) => <option key={slot} value={slot}>{accountLabel(slot, profiles)}</option>)}
          </select>
          <span>{localStorageEnabled ? "Three separate profiles, bill histories and Excel registers" : "One login · three separate business profiles and bill histories"}</span>
        </div>
      </div>
      <div className="top-actions">
        <button className="secondary" onClick={exportExcel} disabled={!profile}>Download Excel</button>
        {localStorageEnabled
          ? <span className="notice">Saved on this computer</span>
          : <><button className="secondary" onClick={connectGoogleDrive}>Connect Google Drive</button><button className="secondary" onClick={() => createBrowserSupabase().auth.signOut().then(() => setSignedIn(false))}>Sign out</button></>}
      </div>
    </header>

    <nav>
      <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>Bills</button>
      <button className={view === "new" ? "active" : ""} onClick={() => { setReplacementSource(null); setView("new"); }}>New bill</button>
      <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>Business profile</button>
    </nav>

    <div className="content">
      {error && <p className="error">{error}</p>}
      {accountLoaded && !profile && view !== "settings" && <section className="panel setup-callout">
        <h2>Set up Account {accountSlot} before issuing the first bill</h2>
        <p>Add this business&apos;s name, address, phone, logo and first bill number. Each account has separate details and bill history.</p>
        <button onClick={() => setView("settings")}>Set up Account {accountSlot}</button>
      </section>}
      {!accountLoaded && isLoading && <section className="panel setup-callout"><p>Loading Account {accountSlot}…</p></section>}
      {view === "settings" && accountLoaded && <ProfileForm key={accountSlot} profile={profile} accountSlot={accountSlot} onSaved={() => void load(query, accountSlot)} />}
      {view === "new" && profile && accountLoaded && <BillForm key={`${accountSlot}-${replacementSource?.id ?? "new"}`} accountSlot={accountSlot} replacementSource={replacementSource} onCreated={issueSuccess} />}
      {view === "dashboard" && accountLoaded && profile && <section className="panel">
        <div className="section-heading history-heading">
          <div><p className="eyebrow">ACCOUNT {accountSlot} HISTORY</p><h2>Issued bills</h2></div>
          <form className="search" onSubmit={(event) => { event.preventDefault(); void load(query, accountSlot); }}>
            <input placeholder="Bill no., customer, or mobile" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button className="secondary">Search</button>
          </form>
        </div>
        <div className="item-table-wrap"><table className="history-table">
          <thead><tr><th>Bill</th><th>Date</th><th>Customer</th><th>Particulars</th><th>Amount</th><th>Excel</th><th /></tr></thead>
          <tbody>{bills.length ? bills.map((bill) => <tr key={bill.id} className={bill.status === "void" ? "void-row" : ""}>
            <td>#{bill.billNumber}<small>{bill.status === "void" ? "Voided" : "Issued"}</small></td>
            <td>{bill.billDate}</td>
            <td><b>{bill.customerName}</b>{bill.phone && <small>{bill.phone}</small>}</td>
            <td>{bill.items.map((item) => item.particulars).join(", ")}</td>
            <td>{formatINR(bill.totalLoanAmount)}</td>
            <td><span className={`sync ${bill.excelSyncStatus}`}>{bill.excelSyncStatus}</span>{bill.excelSyncStatus === "failed" && <button className="text-button" onClick={() => void retryExcel(bill.id)}>Retry</button>}</td>
            <td className="row-actions">
              <button className="text-button" onClick={() => setSelected(bill)}>Open</button>
              {bill.status === "issued" && <><button className="text-button" onClick={() => { setReplacementSource(bill); setView("new"); }}>Replace</button><button className="text-button danger-text" onClick={() => void voidBill(bill.id)}>Void</button></>}
            </td>
          </tr>) : <tr><td colSpan={7} className="empty">No bills found.</td></tr>}</tbody>
        </table></div>
      </section>}
    </div>

    {selected && profile && accountLoaded && <BillDocument bill={selected} profile={profile} accountSlot={accountSlot} onClose={() => setSelected(null)} />}
  </main>;
}
