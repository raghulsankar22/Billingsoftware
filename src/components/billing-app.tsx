"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { accountSlots, isAccountSlot, withAccountSlot } from "@/lib/account-url";
import type { Bill } from "@/lib/types";
import { formatINR } from "@/lib/money";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { api, requestHeaders } from "./api";
import { localStorageEnabled } from "@/lib/storage-mode";
import { BillDocument } from "./bill-document";
import { BillOverview } from "./bill-overview";
import { BillForm } from "./bill-form";
import { BillDelivery } from "./bill-delivery";
import { DeliveryBills } from "./delivery-bills";
import { BusinessUpdates } from "./business-updates";
import { Customers } from "./customers";
import { NoticeBills, OverdueBills } from "./overdue-bills";
import { AllAccountSearch } from "./all-account-search";
import { ProfileForm } from "./profile-form";
import { SignIn } from "./sign-in";
import { LocalSignIn, localAuth } from "./local-sign-in";
import { LocalUserManagement } from "./local-user-management";
import { LocalMyAccount } from "./local-my-account";
import type { LocalUser } from "@/lib/local-users";

type Profile = {
  id?: string;
  account_slot: AccountSlot;
  business_name: string;
  address: string;
  phone: string;
  logo_url?: string | null;
  license_number?: string | null;
  next_bill_number: number;
};

const addAccountOption = "add-new-account";
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
  const [view, setView] = useState<"bills" | "new" | "customers" | "delivery" | "delivery-bills" | "dashboard" | "notice" | "overdue" | "search" | "settings" | "users" | "my-account">("bills");
  const [multiUser, setMultiUser] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [localUser, setLocalUser] = useState<LocalUser | null>(null);
  const [loginNotice, setLoginNotice] = useState("");
  const [selected, setSelected] = useState<Bill | null>(null);
  const [overviewBill, setOverviewBill] = useState<Bill | null>(null);
  const [deliveryDocumentBill, setDeliveryDocumentBill] = useState<Bill | null>(null);
  const [error, setError] = useState("");
  const [excelNotice, setExcelNotice] = useState("");
  const [isRefreshingExcel, setIsRefreshingExcel] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [editingSource, setEditingSource] = useState<Bill | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const loadGeneration = useRef(0);
  const configured = localStorageEnabled || Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  useEffect(() => {
    if (localStorageEnabled) {
      fetch("/api/local-auth", { cache: "no-store" }).then(async response => {
        if (!response.ok) throw new Error("Unable to check sign-in.");
        const result = await response.json();
        setMultiUser(Boolean(result.enabled)); setNeedsSetup(Boolean(result.needsSetup)); setLocalUser(result.user ?? null);
        setSignedIn(!result.enabled || Boolean(result.user));
      }).catch(() => { setError("Unable to check sign-in. Reopen the app and try again."); setSignedIn(false); setMultiUser(true); });
    } else if (configured) {
      createBrowserSupabase().auth.getSession()
        .then(({ data }) => setSignedIn(Boolean(data.session)))
        .catch(() => setSignedIn(false));
    }
  }, [configured]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ACCOUNT_STORAGE_KEY);
      if (saved && /^[1-9]\d*$/.test(saved) && isAccountSlot(Number(saved)) && (localStorageEnabled || Number(saved) <= 3)) setAccountSlot(Number(saved));
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

  useEffect(() => {
    if (!multiUser) return;
    const clear = () => { loadGeneration.current++; setSignedIn(false); setLocalUser(null); setProfile(null); setProfiles([]); setBills([]); setSelected(null); setOverviewBill(null); setDeliveryDocumentBill(null); setEditingSource(null); setLoadedSlot(null); setQuery(""); setAccountSlot(1); setView("bills"); };
    const changed = (event: StorageEvent) => { if (event.key === "finance-billing-user-change") clear(); };
    window.addEventListener("billing-session-expired", clear); window.addEventListener("storage", changed);
    return () => { window.removeEventListener("billing-session-expired", clear); window.removeEventListener("storage", changed); };
  }, [multiUser]);

  async function load(search = "", slot: AccountSlot = accountSlot) {
    const generation = ++loadGeneration.current;
    setIsLoading(true);
    try {
      const [profileResult, billsResult] = await Promise.all([
        api("/api/profile", slot),
        api(`/api/bills${search ? `?q=${encodeURIComponent(search)}` : ""}`, slot),
      ]);
      if (generation !== loadGeneration.current) return;
      if (slot > 3 && !profileResult.profile) { setAccountSlot(1); return; }
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
  if (!signedIn) return localStorageEnabled && multiUser ? <LocalSignIn setup={needsSetup} notice={loginNotice} onSignedIn={user => { setLoginNotice(""); setLocalUser(user); setNeedsSetup(false); setAccountSlot(1); setSignedIn(true); try { window.localStorage.setItem("finance-billing-user-change", crypto.randomUUID()); } catch {} }} /> : <SignIn onSignedIn={() => setSignedIn(true)} />;

  function clearLocalSession() {
    loadGeneration.current++; setSignedIn(false); setLocalUser(null); setProfile(null); setProfiles([]); setBills([]); setSelected(null); setOverviewBill(null); setDeliveryDocumentBill(null); setEditingSource(null); setLoadedSlot(null); setQuery(""); setAccountSlot(1); setView("bills");
    try { window.localStorage.setItem("finance-billing-user-change", crypto.randomUUID()); } catch {}
  }
  async function signOutLocal() {
    if ((view === "new" || view === "customers" || view === "settings") && !window.confirm("Sign out? Unsaved changes will be discarded.")) return;
    try { await localAuth("logout"); clearLocalSession(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to sign out."); }
  }

  function selectAccount(value: string, created = false) {
    if (value === addAccountOption) { setAddingAccount(true); return; }
    const selectedSlot = Number(value);
    if (!isAccountSlot(selectedSlot) || (!created && !accountSlots(profiles).includes(selectedSlot)) || selectedSlot === accountSlot) return;
    if ((view === "new" || view === "customers") && !window.confirm("Switch accounts? Unsaved details will be discarded.")) {
      if (created) { void load(query, accountSlot); setExcelNotice(`Account ${selectedSlot} created. Select it from Business account when you are ready to switch.`); }
      return;
    }

    setAccountSlot(selectedSlot as AccountSlot);
    setLoadedSlot(null);
    setProfile(null);
    setBills([]);
    setQuery("");
    setSelected(null);
    setOverviewBill(null);
    setDeliveryDocumentBill(null);
    setEditingSource(null);
    setView("bills");
    setError("");
    setExcelNotice("");
  }

  const issueSuccess = (bill: Bill) => {
    setEditingSource(null);
    setSelected(bill);
    setView("bills");
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

  async function deleteBill(bill: Bill) {
    if (!window.confirm(`Permanently delete bill #${bill.billNumber}? It will be removed from history, its PDF and the Excel register. This cannot be undone. If this is the latest bill, the next bill will use #${bill.billNumber} again.`)) return;
    try {
      const result = await api(`/api/bills/${bill.id}`, accountSlot, { method: "DELETE" });
      if (selected?.id === bill.id) setSelected(null);
      if (overviewBill?.id === bill.id) setOverviewBill(null);
      if (deliveryDocumentBill?.id === bill.id) setDeliveryDocumentBill(null);
      await load(query, accountSlot);
      if (result.warning) setError(result.warning);
      setExcelNotice(`Bill #${bill.billNumber} deleted. The next bill will be #${result.nextBillNumber}.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to delete bill.");
    }
  }

  async function refreshExcel() {
    if (isRefreshingExcel) return;
    setIsRefreshingExcel(true);
    setExcelNotice("");
    try {
      const result = await api("/api/reports/excel", accountSlot, { method: "POST" });
      await load(query, accountSlot);
      setExcelNotice(`Excel refreshed and saved to ${result.savedTo}. If you opened a downloaded copy, use Download Excel to get the latest version.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to refresh Excel register.");
    } finally {
      setIsRefreshingExcel(false);
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
        <div className="app-brand-title">
          <img className="app-header-logo" src="/business-logo.jpg" alt="Business logo" />
          <div>
          <p className="eyebrow">FINANCE BILLING</p>
          <h1>{accountLoaded ? profile?.business_name || `Account ${accountSlot}` : `Account ${accountSlot}`}</h1>
          </div>
        </div>
        <div className="account-picker">
          <label htmlFor="business-account">Business account</label>
          <select id="business-account" value={accountSlot} onChange={(event) => selectAccount(event.target.value)}>
            {accountSlots(profiles).map((slot) => <option key={slot} value={slot}>{accountLabel(slot, profiles)}</option>)}
            {localStorageEnabled && <option value={addAccountOption}>+ Add new account…</option>}
          </select>
          <span>{localStorageEnabled ? "Separate profiles, bill histories and Excel registers for every account" : "One login · three separate business profiles and bill histories"}</span>
          {localStorageEnabled && <button type="button" className="account-add-button" onClick={() => setAddingAccount(true)}>+ Add new account</button>}
        </div>
      </div>
      <div className="topbar-controls">
        {accountLoaded && profile?.license_number && <p className="app-license-number">License No.: {profile.license_number}</p>}
      <div className="top-actions">
        {multiUser && localUser && <><span className="local-user-name">{localUser.username}</span><button className="secondary" onClick={() => void signOutLocal()}>Sign out</button></>}
        <button className="secondary" onClick={exportExcel} disabled={!profile}>Download Excel</button>
        <button className="secondary" onClick={() => void refreshExcel()} disabled={!profile || isRefreshingExcel}>{isRefreshingExcel ? "Refreshing…" : "Refresh Excel"}</button>
        {!localStorageEnabled && <><button className="secondary" onClick={connectGoogleDrive}>Connect Google Drive</button><button className="secondary" onClick={() => createBrowserSupabase().auth.signOut().then(() => setSignedIn(false))}>Sign out</button></>}
      </div>
      </div>
    </header>

    <nav className="side-nav" aria-label="Billing menu">
      {localStorageEnabled && <button className={view === "dashboard" ? "active" : ""} aria-current={view === "dashboard" ? "page" : undefined} onClick={() => { setExcelNotice(""); setView("dashboard"); }}><span className="nav-icon" aria-hidden="true">📊</span>Dashboard</button>}
      {localStorageEnabled && <button className={view === "customers" ? "active" : ""} onClick={() => { setExcelNotice(""); setView("customers"); }}><span className="nav-icon" aria-hidden="true">👥</span>Customers</button>}
      <button className={view === "new" ? "active" : ""} onClick={() => { setExcelNotice(""); setEditingSource(null); setView("new"); }}><span className="nav-icon" aria-hidden="true">📝</span>New bill</button>
      {localStorageEnabled && <button className={view === "delivery" ? "active" : ""} onClick={() => { setExcelNotice(""); setView("delivery"); }}><span className="nav-icon" aria-hidden="true">📦</span>Delivery</button>}
      <button className={view === "bills" ? "active" : ""} aria-current={view === "bills" ? "page" : undefined} onClick={() => { setExcelNotice(""); setView("bills"); }}><span className="nav-icon" aria-hidden="true">📚</span>All bills</button>
      {localStorageEnabled && <button className={view === "delivery-bills" ? "active" : ""} onClick={() => { setExcelNotice(""); setView("delivery-bills"); }}><span className="nav-icon" aria-hidden="true">🧾</span>Delivery Bills</button>}
      {localStorageEnabled && <button className={view === "notice" ? "active" : ""} aria-current={view === "notice" ? "page" : undefined} onClick={() => { setExcelNotice(""); setView("notice"); }}><span className="nav-icon" aria-hidden="true">📨</span>Notice</button>}
      {localStorageEnabled && <button className={view === "overdue" ? "active" : ""} aria-current={view === "overdue" ? "page" : undefined} onClick={() => { setExcelNotice(""); setView("overdue"); }}><span className="nav-icon" aria-hidden="true">⏰</span>Overdue</button>}
      {localStorageEnabled && <button className={view === "search" ? "active" : ""} aria-current={view === "search" ? "page" : undefined} onClick={() => { setExcelNotice(""); setView("search"); }}><span className="nav-icon" aria-hidden="true">🔍</span>Search</button>}
      {multiUser && localUser && <button className={view === "my-account" ? "active" : ""} onClick={() => { setExcelNotice(""); setView("my-account"); }}><span className="nav-icon" aria-hidden="true">🔐</span>My account</button>}
      {multiUser && localUser?.administrator && <button className={view === "users" ? "active" : ""} onClick={() => { setExcelNotice(""); setView("users"); }}><span className="nav-icon" aria-hidden="true">👤</span>Users</button>}
      <button className={`business-profile-tab${view === "settings" ? " active" : ""}`} onClick={() => { setExcelNotice(""); setView("settings"); }}><span className="nav-icon" aria-hidden="true">⚙️</span>Business profile</button>
    </nav>

    <div className="content">
      {error && <p className="error">{error}</p>}
      {excelNotice && <p className="excel-notice" role="status">{excelNotice}</p>}
      {view === "users" && localUser?.administrator && <LocalUserManagement currentUser={localUser} onSignedOut={clearLocalSession} />}
      {view === "my-account" && localUser && <LocalMyAccount user={localUser} onChanged={() => { setLoginNotice("Password changed. Sign in with your new password."); clearLocalSession(); }} />}
      {accountLoaded && !profile && view !== "settings" && view !== "search" && view !== "customers" && view !== "my-account" && view !== "users" && <section className="panel setup-callout">
        <h2>Set up Account {accountSlot} before issuing the first bill</h2>
        <p>Add this business&apos;s name, address, phone, logo and first bill number. Each account has separate details and bill history.</p>
        <button onClick={() => setView("settings")}>Set up Account {accountSlot}</button>
      </section>}
      {!accountLoaded && isLoading && <section className="panel setup-callout"><p>Loading Account {accountSlot}…</p></section>}
      {view === "settings" && accountLoaded && <ProfileForm key={accountSlot} profile={profile} accountSlot={accountSlot} onSaved={() => void load(query, accountSlot)} />}
      {view === "new" && profile && accountLoaded && <BillForm key={`${accountSlot}-${editingSource?.id ?? "new"}`} accountSlot={accountSlot} editingSource={editingSource} onCreated={issueSuccess} />}
      {view === "customers" && accountLoaded && <Customers key={accountSlot} accountSlot={accountSlot} />}
      {view === "delivery" && profile && accountLoaded && <BillDelivery key={accountSlot} accountSlot={accountSlot} onSaved={(bill) => { setDeliveryDocumentBill(bill); void load(query, accountSlot); }} onBatchSaved={() => void load(query, accountSlot)} onOpen={setSelected} onOverview={setOverviewBill} onReceipt={setDeliveryDocumentBill} />}
      {view === "delivery-bills" && profile && accountLoaded && <DeliveryBills key={accountSlot} accountSlot={accountSlot} onOpen={setDeliveryDocumentBill} onOriginal={setSelected} />}
      {view === "dashboard" && profile && accountLoaded && <BusinessUpdates key={accountSlot} accountSlot={accountSlot} onBill={setSelected} onDelivery={setDeliveryDocumentBill} />}
      {view === "overdue" && profile && accountLoaded && <OverdueBills key={accountSlot} accountSlot={accountSlot} onOpen={setSelected} onOverview={setOverviewBill} />}
      {view === "notice" && profile && accountLoaded && <NoticeBills key={accountSlot} accountSlot={accountSlot} onOpen={setSelected} onOverview={setOverviewBill} />}
      {view === "search" && accountLoaded && <AllAccountSearch accountSlot={accountSlot} />}
      {view === "bills" && accountLoaded && profile && <section className="panel">
        <div className="section-heading history-heading">
          <div><p className="eyebrow">ACCOUNT {accountSlot} HISTORY</p><h2>All bills</h2></div>
          <form className="search" onSubmit={(event) => { event.preventDefault(); void load(query, accountSlot); }}>
            <input placeholder="Bill no., customer, or mobile" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button className="secondary">Search</button>
          </form>
        </div>
        <div className="item-table-wrap"><table className="history-table">
          <thead><tr><th>Bill</th><th>Date</th><th>Customer</th><th>Particulars</th><th>Amount</th><th>Excel</th><th /></tr></thead>
          <tbody>{bills.length ? bills.map((bill) => <tr key={bill.id} className={bill.status === "void" ? "void-row" : ""}>
            <td>#{bill.billNumber}<small>{bill.status === "void" ? bill.deliveryNo && bill.deliveryDate ? "Voided · Delivered" : "Voided" : bill.deliveryNo && bill.deliveryDate ? "Delivered" : "Issued"}</small>{bill.deliveryNo && bill.deliveryDate && <small className="delivery-recorded">Delivery #{bill.deliveryNo} · {bill.deliveryDate}</small>}</td>
            <td>{bill.billDate}</td>
            <td><b>{bill.customerName}</b>{bill.phone && <small>{bill.phone}</small>}</td>
            <td>{bill.items.map((item) => `${item.metal ? `${item.metal}: ` : ""}${item.particulars}`).join(", ")}</td>
            <td>{formatINR(bill.totalLoanAmount)}</td>
            <td><span className={`sync ${bill.excelSyncStatus}`}>{bill.excelSyncStatus}</span>{bill.excelSyncStatus === "failed" && <button className="text-button" onClick={() => void retryExcel(bill.id)}>Retry</button>}</td>
            <td className="row-actions">
              <button className="text-button" onClick={() => setOverviewBill(bill)}>Overview</button>
              <button className="text-button" onClick={() => setSelected(bill)}>Open</button>
              {bill.status === "issued" && <><button className="text-button" onClick={() => { setEditingSource(bill); setView("new"); }}>{localStorageEnabled ? "Edit" : "Replace"}</button><button className="text-button danger-text" onClick={() => void voidBill(bill.id)}>Void</button></>}
              {localStorageEnabled && <button className="text-button danger-text" onClick={() => void deleteBill(bill)}>Delete</button>}
            </td>
          </tr>) : <tr><td colSpan={7} className="empty">No bills found.</td></tr>}</tbody>
        </table></div>
      </section>}
    </div>

    {addingAccount && <div className="modal-backdrop"><div className="account-modal" role="dialog" aria-modal="true" aria-label="Add new account" onKeyDown={event => {
      if (event.key !== "Tab") return;
      const fields = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)")];
      const first = fields[0]; const last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}><ProfileForm profile={null} accountSlot={accountSlot} creatingAccount onCancel={() => setAddingAccount(false)} onSaved={slot => { setAddingAccount(false); if (slot) selectAccount(String(slot), true); }} /></div></div>}
    {selected && profile && accountLoaded && <BillDocument bill={selected} profile={profile} accountSlot={accountSlot} onClose={() => setSelected(null)} />}
    {overviewBill && accountLoaded && <BillOverview key={overviewBill.id} bill={overviewBill} onClose={() => setOverviewBill(null)} />}
    {deliveryDocumentBill && profile && accountLoaded && <BillDocument key={`delivery-${deliveryDocumentBill.id}`} bill={deliveryDocumentBill} profile={profile} accountSlot={accountSlot} documentType="delivery" onClose={() => setDeliveryDocumentBill(null)} />}
  </main>;
}
