"use client";

import { useLanguage } from "./language-provider";
import { formatParticulars } from "@/lib/jewellery";

import { useEffect, useRef, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { accountSlots, isAccountSlot, withAccountSlot } from "@/lib/account-url";
import { fileMenuEvent, fileMenuPage } from "@/lib/file-menu";
import type { Bill } from "@/lib/types";
import { formatINR } from "@/lib/money";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { api, requestHeaders } from "./api";
import { extendedAccounts, localStorageEnabled } from "@/lib/storage-mode";
import { BillDocument } from "./bill-document";
import { BillOverview } from "./bill-overview";
import { BillForm } from "./bill-form";
import { BillDelivery } from "./bill-delivery";
import { DeliveryBills } from "./delivery-bills";
import { CustomerBillLost } from "./customer-bill-lost";
import { BackupPanel } from "./backup-panel";
import { AutoBackup } from "./auto-backup";
import { BillHistory } from "./bill-history";
import type { ChangeReason } from "@/lib/bill-history-types";
import { BillChangeReasonDialog } from "./bill-change-reason-dialog";
import { BusinessUpdates } from "./business-updates";
import { Customers } from "./customers";
import { NoticeBills, OverdueBills } from "./overdue-bills";
import { AllAccountSearch } from "./all-account-search";
import { ProfileForm } from "./profile-form";
import { SignIn } from "./sign-in";
import { LocalSignIn, localAuth } from "./local-sign-in";
import { LocalUserManagement } from "./local-user-management";
import { LocalMyAccount } from "./local-my-account";
import { ImportPreview } from "./import-preview";
import { SideNav, type NavView } from "./side-nav";
import { deliveryLabel, isDelivered } from "@/lib/delivery-status";
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

function accountLabel(slot: AccountSlot, profiles: Profile[], t: (text: string) => string) {
  const profile = profiles.find((candidate) => Number(candidate.account_slot) === slot);
  return profile?.business_name ? `${t("Account")} ${slot} · ${profile.business_name}` : `${t("Account")} ${slot} · ${t("set up business")}`;
}

function safeFilenamePart(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim() || "Business";
}

export function BillingApp() {
  const { t } = useLanguage();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [accountSlot, setAccountSlot] = useState<AccountSlot>(1);
  const [accountReady, setAccountReady] = useState(false);
  const [loadedSlot, setLoadedSlot] = useState<AccountSlot | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<NavView>("bills");
  /** Bumped after every successful reload, so the menu counts follow saves, edits, deletes and deliveries. */
  const [navCountsVersion, setNavCountsVersion] = useState(0);
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reasonRequest, setReasonRequest] = useState<{ resolve: (reason: ChangeReason | null) => void } | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [inDesktopApp, setInDesktopApp] = useState(false);
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
      if (saved && /^[1-9]\d*$/.test(saved) && isAccountSlot(Number(saved)) && (extendedAccounts || Number(saved) <= 3)) setAccountSlot(Number(saved));
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
      setNavCountsVersion(version => version + 1);
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

  useEffect(() => { setInDesktopApp(navigator.userAgent.includes("Electron")); }, []);

  useEffect(() => {
    if (!signedIn) return;
    const open = (event: Event) => {
      const page = fileMenuPage((event as CustomEvent).detail, { localStorage: localStorageEnabled, signedInUser: Boolean(multiUser && localUser), administrator: Boolean(multiUser && localUser?.administrator) });
      if (!page) { setError("This page isn't available for your sign-in."); return; }
      setSelected(null); setOverviewBill(null); setDeliveryDocumentBill(null); setAddingAccount(false);
      setError(""); setExcelNotice(""); setView(page);
    };
    window.addEventListener(fileMenuEvent, open);
    return () => window.removeEventListener(fileMenuEvent, open);
  }, [signedIn, multiUser, localUser]);

  if (!configured) return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">{t("ONE-TIME SETUP REQUIRED")}</p><h1>{t("Finance Billing")}</h1><p>{t("The app is installed correctly, but needs its secure cloud database details before it can accept bills.")}</p><ol className="setup-steps"><li>{t("Create a Supabase project.")}</li><li>{t("Apply all SQL files in")} <code>{t("supabase/migrations")}</code> {t("in order (001–004, then the Google Drive migration).")}</li><li>{t("Copy")} <code>{t(".env.example")}</code> {t("to")} <code>{t(".env.local")}</code> {t("and add the Supabase URL, anon key, and server service-role key.")}</li><li>{t("Restart this server.")}</li></ol><p className="notice">{t("Your Google Drive details can be added after this first setup.")}</p></section></main>;
  if (signedIn === null || !accountReady) return <main className="auth-shell"><p>{t("Loading secure billing…")}</p></main>;
  if (!signedIn) return localStorageEnabled && multiUser ? <LocalSignIn setup={needsSetup} notice={loginNotice} onSignedIn={user => { setLoginNotice(""); setLocalUser(user); setNeedsSetup(false); setAccountSlot(1); setSignedIn(true); try { window.localStorage.setItem("finance-billing-user-change", crypto.randomUUID()); } catch {} }} /> : <SignIn onSignedIn={() => setSignedIn(true)} />;

  function clearLocalSession() {
    loadGeneration.current++; setSignedIn(false); setLocalUser(null); setProfile(null); setProfiles([]); setBills([]); setSelected(null); setOverviewBill(null); setDeliveryDocumentBill(null); setEditingSource(null); setLoadedSlot(null); setQuery(""); setAccountSlot(1); setView("bills");
    try { window.localStorage.setItem("finance-billing-user-change", crypto.randomUUID()); } catch {}
  }
  async function signOutLocal() {
    if ((view === "new" || view === "customers" || view === "settings") && !window.confirm(t("Sign out? Unsaved changes will be discarded."))) return;
    try { await localAuth("logout"); clearLocalSession(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to sign out."); }
  }

  function selectAccount(value: string, created = false) {
    if (value === addAccountOption) { setAddingAccount(true); return; }
    const selectedSlot = Number(value);
    if (!isAccountSlot(selectedSlot) || (!created && !accountSlots(profiles).includes(selectedSlot)) || selectedSlot === accountSlot) return;
    if ((view === "new" || view === "customers") && !window.confirm(t("Switch accounts? Unsaved details will be discarded."))) {
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
    setView(localStorageEnabled ? "dashboard" : "bills");
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
      const response = await fetch(withAccountSlot(localStorageEnabled ? "/api/reports/excel?scope=all" : "/api/reports/excel", accountSlot), { headers: await requestHeaders() });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Excel export failed.");
      }
      const link = document.createElement("a");
      const business = safeFilenamePart(profile?.business_name || `Account ${accountSlot}`);
      link.href = URL.createObjectURL(await response.blob());
      link.download = localStorageEnabled ? "Finance Billing - All Accounts.xlsx" : `Finance Billing - ${business} - Account ${accountSlot}.xlsx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to export Excel.");
    }
  }

  function askChangeReason(): Promise<ChangeReason | null> {
    return new Promise(resolve => setReasonRequest({ resolve }));
  }
  async function voidBill(id: string) {
    if (!window.confirm(t("Void this bill? It will remain in history and cannot be edited."))) return;
    const reason = localStorageEnabled ? await askChangeReason() : "correction"; if (!reason) return;
    try {
      await api(`/api/bills/${id}/void`, accountSlot, { method: "POST", headers: { "x-billing-change-reason": reason } });
      await load(query, accountSlot);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to void bill.");
    }
  }

  async function deleteBill(bill: Bill) {
    if (!window.confirm(t(`Permanently delete bill #${bill.billNumber}? It will be removed from the bill list, its PDF and the Excel register. A read-only change-history entry will remain. This cannot be undone. If this is the latest bill, the next bill will use #${bill.billNumber} again.`))) return;
    const reason = localStorageEnabled ? await askChangeReason() : "correction"; if (!reason) return;
    try {
      const result = await api(`/api/bills/${bill.id}`, accountSlot, { method: "DELETE", headers: { "x-billing-change-reason": reason } });
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
      const result = await api(localStorageEnabled ? "/api/reports/excel?scope=all" : "/api/reports/excel", accountSlot, { method: "POST" });
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
    {localStorageEnabled && <AutoBackup onError={setError} />}
    {reasonRequest && <BillChangeReasonDialog onDone={reason => { reasonRequest.resolve(reason); setReasonRequest(null); }} />}
    <header className="topbar">
      <div className="topbar-brand">
        <div className="app-brand-title">
          <img className="app-header-logo" src="/business-logo.jpg" alt={t("Business logo")} />
          <div>
          <p className="eyebrow">{t("FINANCE BILLING")}</p>
          <h1>{accountLoaded ? profile?.business_name || `${t("Account")} ${accountSlot}` : `${t("Account")} ${accountSlot}`}</h1>
          </div>
        </div>
        <div className="account-picker">
          <label htmlFor="business-account">{t("Business account")}</label>
          <select id="business-account" value={accountSlot} onChange={(event) => selectAccount(event.target.value)}>
            {accountSlots(profiles).map((slot) => <option key={slot} value={slot}>{accountLabel(slot, profiles, t)}</option>)}
            {extendedAccounts && <option value={addAccountOption}>{t("+ Add new account…")}</option>}
          </select>
          <span>{extendedAccounts ? t("Separate profiles, bill histories and Excel registers for every account") : t("One login · three separate business profiles and bill histories")}</span>
          {extendedAccounts && <button type="button" className="account-add-button" onClick={() => setAddingAccount(true)}>{t("+ Add new account")}</button>}
        </div>
      </div>
      <div className="topbar-controls">
        {accountLoaded && profile?.license_number && <p className="app-license-number">{t("License No.:")} {profile.license_number}</p>}
      <div className="top-actions">
        {multiUser && localUser && <><span className="local-user-name">{localUser.username}</span><button className="secondary" onClick={() => void signOutLocal()}>{t("Sign out")}</button></>}
        {!localStorageEnabled && <><button className="secondary" onClick={exportExcel} disabled={!profile}>{t("Download Excel")}</button><button className="secondary" onClick={() => void refreshExcel()} disabled={!profile || isRefreshingExcel}>{isRefreshingExcel ? t("Refreshing…") : t("Refresh Excel")}</button><button className="secondary" onClick={connectGoogleDrive}>{t("Connect Google Drive")}</button><button className="secondary" onClick={() => createBrowserSupabase().auth.signOut().then(() => setSignedIn(false))}>{t("Sign out")}</button></>}
      </div>
      </div>
    </header>

    <SideNav view={view} accountSlot={accountSlot} countsVersion={navCountsVersion} countsEnabled={accountLoaded && Boolean(profile)}
      access={{ localStorage: localStorageEnabled, inDesktopApp, signedInUser: Boolean(multiUser && localUser), administrator: Boolean(multiUser && localUser?.administrator) }}
      onSelect={next => { setExcelNotice(""); if (next === "new") setEditingSource(null); setView(next); }} />

    <div className="content">
      {error && <p className="error">{t(error)}</p>}
      {excelNotice && <p className="excel-notice" role="status">{t(excelNotice)}</p>}
      {view === "users" && localUser?.administrator && <LocalUserManagement currentUser={localUser} onSignedOut={clearLocalSession} />}
      {view === "my-account" && localUser && <LocalMyAccount user={localUser} onChanged={() => { setLoginNotice("Password changed. Sign in with your new password."); clearLocalSession(); }} />}
      {accountLoaded && !profile && view !== "settings" && view !== "search" && view !== "customers" && view !== "my-account" && view !== "users" && <section className="panel setup-callout">
        <h2>{t("Set up Account")} {accountSlot} {t("before issuing the first bill")}</h2>
        <p>{t("Add this business's name, address, phone, logo and first bill number. Each account has separate details and bill history.")}</p>
        <button onClick={() => setView("settings")}>{t("Set up Account")} {accountSlot}</button>
      </section>}
      {!accountLoaded && isLoading && <section className="panel setup-callout"><p>{t("Loading Account")} {accountSlot}…</p></section>}
      {view === "settings" && accountLoaded && <ProfileForm key={accountSlot} profile={profile} accountSlot={accountSlot} onSaved={() => void load(query, accountSlot)} />}
      {view === "new" && profile && accountLoaded && <BillForm key={`${accountSlot}-${editingSource?.id ?? "new"}`} accountSlot={accountSlot} draftUserId={multiUser ? localUser?.id : "local-owner"} editingSource={editingSource} onCreated={issueSuccess} />}
      {view === "customers" && accountLoaded && <Customers key={accountSlot} accountSlot={accountSlot} />}
      {view === "delivery" && profile && accountLoaded && <BillDelivery key={accountSlot} accountSlot={accountSlot} profile={profile} onSaved={(bill) => { setDeliveryDocumentBill(bill); void load(query, accountSlot); }} onBatchSaved={() => void load(query, accountSlot)} onOpen={setSelected} onOverview={setOverviewBill} onReceipt={setDeliveryDocumentBill} />}
      {view === "lost-bills" && profile && accountLoaded && <CustomerBillLost key={accountSlot} accountSlot={accountSlot} profile={profile} onReceipt={setDeliveryDocumentBill} onOriginal={setSelected} />}
      {view === "delivery-bills" && profile && accountLoaded && <DeliveryBills key={accountSlot} accountSlot={accountSlot} onOpen={setDeliveryDocumentBill} onOriginal={setSelected} />}
      {view === "dashboard" && profile && accountLoaded && localStorageEnabled && <BackupPanel key={`backup-${accountSlot}`} accountSlot={accountSlot} />}
      {view === "dashboard" && profile && accountLoaded && <BusinessUpdates key={accountSlot} accountSlot={accountSlot} onBill={setSelected} onDelivery={setDeliveryDocumentBill} onExportExcel={exportExcel} onRefreshExcel={refreshExcel} isRefreshingExcel={isRefreshingExcel} />}
      {view === "overdue" && profile && accountLoaded && <OverdueBills key={accountSlot} accountSlot={accountSlot} onOpen={setSelected} onOverview={setOverviewBill} />}
      {view === "notice" && profile && accountLoaded && <NoticeBills key={accountSlot} accountSlot={accountSlot} profile={profile} onOpen={setSelected} onOverview={setOverviewBill} />}
      {view === "search" && accountLoaded && <AllAccountSearch accountSlot={accountSlot} />}
      {view === "import" && profile && accountLoaded && <ImportPreview key={accountSlot} accountSlot={accountSlot} onImported={() => void load(query, accountSlot)} />}
      {view === "bills" && accountLoaded && profile && <section className="panel">
        {localStorageEnabled && <div className="form-actions"><button type="button" className="secondary" onClick={() => setHistoryOpen(value => !value)}>{t("Bill change history")}</button></div>}
        {localStorageEnabled && historyOpen && <BillHistory key={accountSlot} accountSlot={accountSlot} refreshVersion={navCountsVersion} onClose={() => setHistoryOpen(false)} />}
        <div className="section-heading history-heading">
          <div><p className="eyebrow">{t("ACCOUNT")} {accountSlot} {t("HISTORY")}</p><h2>{t("All bills")}</h2></div>
          <form className="search" onSubmit={(event) => { event.preventDefault(); void load(query, accountSlot); }}>
            <input placeholder={t("Bill no., customer, or mobile")} value={query} onChange={(event) => setQuery(event.target.value)} />
            <button className="secondary">{t("Search")}</button>
          </form>
        </div>
        <div className="item-table-wrap"><table className="history-table">
          <thead><tr><th>{t("Bill")}</th><th>{t("Date")}</th><th>{t("Customer")}</th><th>{t("Particulars")}</th><th>{t("Amount")}</th><th>{t("Excel")}</th><th /></tr></thead>
          <tbody>{bills.length ? bills.map((bill) => <tr key={bill.id} className={bill.status === "void" ? "void-row" : ""}>
            <td>#{bill.billNumber}<small>{bill.status === "void" ? isDelivered(bill) ? t("Voided · Delivered") : t("Voided") : isDelivered(bill) ? t("Delivered") : t("Issued")}</small>{isDelivered(bill) && <small className="delivery-recorded">{t(deliveryLabel(bill))}</small>}</td>
            <td>{bill.billDate}</td>
            <td><b>{bill.customerName}</b>{bill.phone && <small>{bill.phone}</small>}</td>
            <td>{bill.items.map((item) => `${item.metal ? `${t(item.metal)}: ` : ""}${formatParticulars(item.particulars)}`).join(", ")}</td>
            <td>{formatINR(bill.totalLoanAmount)}</td>
            <td><span className={`sync ${bill.excelSyncStatus}`}>{t(bill.excelSyncStatus)}</span>{bill.excelSyncStatus === "failed" && <button className="text-button" onClick={() => void retryExcel(bill.id)}>{t("Retry")}</button>}</td>
            <td className="row-actions">
              <button className="text-button" onClick={() => setOverviewBill(bill)}>{t("Overview")}</button>
              <button className="text-button" onClick={() => setSelected(bill)}>{t("Open")}</button>
              {bill.status === "issued" && <><button className="text-button" onClick={() => { setEditingSource(bill); setView("new"); }}>{localStorageEnabled ? t("Edit") : t("Replace")}</button><button className="text-button danger-text" onClick={() => void voidBill(bill.id)}>{t("Void")}</button></>}
              {localStorageEnabled && <button className="text-button danger-text" onClick={() => void deleteBill(bill)}>{t("Delete")}</button>}
            </td>
          </tr>) : <tr><td colSpan={7} className="empty">{t("No bills found.")}</td></tr>}</tbody>
        </table></div>
      </section>}
    </div>

    {addingAccount && <div className="modal-backdrop"><div className="account-modal" role="dialog" aria-modal="true" aria-label={t("Add new account")} onKeyDown={event => {
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
