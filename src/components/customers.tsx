"use client";

import { useLanguage } from "./language-provider";

import { useEffect, useRef, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import type { Customer, CustomerInput } from "@/lib/customers";
import { EnglishRecordField } from "./english-record-field";
import { api } from "./api";
import { capitalizeWords, holdCaret } from "@/lib/text-case";

type SharedCustomer = Pick<Customer, "name" | "customerCode">;
const emptyCustomer = (): CustomerInput => ({ name: "", fatherName: "", address: "", phone: "", aadhaar: "" });

export function Customers({ accountSlot }: { accountSlot: AccountSlot }) {
  const { t } = useLanguage();
  const formElement = useRef<HTMLFormElement>(null);
  const [formRevision, setFormRevision] = useState(0);
  const [form, setForm] = useState<CustomerInput>(emptyCustomer);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customerCode, setCustomerCode] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [sharedPhone, setSharedPhone] = useState<SharedCustomer | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api(`/api/customers?q=${encodeURIComponent(query)}`, accountSlot)
        .then(result => { if (active) { setCustomers(result.customers); setLoadError(""); } })
        .catch(failure => { if (active) setLoadError(failure instanceof Error ? failure.message : "Unable to load customers."); })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [accountSlot, query, refresh]);

  function reset() { setFormRevision(value => value + 1); setForm(emptyCustomer()); setEditingId(null); setCustomerCode(""); setError(""); }
  function edit(customer: Customer) {
    setFormRevision(value => value + 1);
    setForm({ name: customer.name, fatherName: customer.fatherName, address: customer.address, phone: customer.phone, aadhaar: customer.aadhaar });
    setEditingId(customer.id); setCustomerCode(customer.customerCode); setError(""); setNotice("");
    document.getElementById("customer-name")?.focus();
  }
  async function save(event?: React.FormEvent, allowSharedPhone = false) {
    event?.preventDefault();
    if (busy || !formElement.current?.reportValidity()) return;
    setBusy(true); setError(""); setNotice(""); setSharedPhone(null);
    try {
      const result = await api("/api/customers", accountSlot, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({ ...form, ...(editingId ? { id: editingId } : {}), ...(allowSharedPhone ? { allowSharedPhone: true } : {}) }),
      });
      reset(); setQuery(""); setRefresh(value => value + 1);
      setNotice(`${result.customer.name} ${editingId ? "updated" : "saved"}. Customer ID: ${result.customer.customerCode}. Enter their phone number or Aadhaar in New bill to find them.`);
    } catch (failure) {
      const shared = (failure as { payload?: { sharedPhone?: SharedCustomer } }).payload?.sharedPhone;
      if (shared) setSharedPhone(shared);
      else setError(failure instanceof Error ? failure.message : "Unable to save customer.");
    }
    finally { setBusy(false); }
  }

  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">{t("SHARED CUSTOMER DIRECTORY")}</p><h2>{t("Customer")}</h2><p className="muted">{t("One customer ID across every business account. Save details once and reuse them in any account's New bill.")}</p></div></div>
    <form ref={formElement} onSubmit={save} className="customer-entry">
      <h3>{editingId ? t("Edit customer") : t("Add customer")}</h3>
      <p className="customer-code-note">{editingId ? `${t("Customer ID:")} ${customerCode}` : t("A unique customer ID will be assigned automatically when you save.")}</p>
      <fieldset key={formRevision} disabled={busy}>
        <div className="form-grid">
          <EnglishRecordField id="customer-name" label="Customer name" value={form.name} minLength={2} maxLength={120} required onChange={value => { holdCaret(); const name = capitalizeWords(value); setForm(current => ({ ...current, name })); }} />
          <EnglishRecordField label="Father's name" value={form.fatherName} minLength={2} maxLength={120} required onChange={value => { holdCaret(); const fatherName = capitalizeWords(value); setForm(current => ({ ...current, fatherName })); }} />
          <label><span>{t("Mobile number")} <span className="muted">{t("(optional)")}</span></span><input type="tel" inputMode="tel" maxLength={20} placeholder={t("10-digit mobile number")} value={form.phone} onChange={e => setForm(current => ({ ...current, phone: e.target.value }))} /></label>
          <label><span>{t("Aadhaar")} <span className="muted">{t("(optional)")}</span></span><input inputMode="numeric" maxLength={17} placeholder={t("12-digit Aadhaar number")} value={form.aadhaar} onChange={e => setForm(current => ({ ...current, aadhaar: e.target.value }))} /></label>
          <EnglishRecordField label="Address" multiline className="wide" value={form.address} minLength={5} maxLength={500} required onChange={value => { holdCaret(); const address = capitalizeWords(value); setForm(current => ({ ...current, address })); }} />
        </div>
        <div className="customer-actions"><button>{busy ? t("Saving…") : editingId ? t("Save customer changes") : t("Save customer")}</button>{editingId && <button type="button" className="secondary" onClick={reset}>{t("Cancel edit")}</button>}</div>
      </fieldset>
      {error && <p className="error" role="alert">{t(error)}</p>}
      {sharedPhone && <div className="overview-warning" role="alert"><p>{t("This phone is already saved for")} <b>{sharedPhone.name}</b> ({sharedPhone.customerCode}{t("). Is this a different person, such as a family member?")}</p><div className="customer-actions"><button type="button" disabled={busy} onClick={() => void save(undefined, true)}>{t("Yes, save as a new customer")}</button><button type="button" className="secondary" disabled={busy} onClick={() => setSharedPhone(null)}>{t("No, go back")}</button></div></div>}
      {notice && <p className="notice" role="status">{t(notice)}</p>}
    </form>
    <div className="section-heading customer-list-heading"><h3>{t("Saved customers")}</h3><label className="customer-search">{t("Search customers")}<input type="search" placeholder={t("Customer ID, name, phone or Aadhaar")} value={query} onChange={e => setQuery(e.target.value)} /></label></div>
    {loadError && <p className="error" role="alert">{t(loadError)} <button type="button" className="text-button" onClick={() => setRefresh(value => value + 1)}>{t("Retry")}</button></p>}
    <div className="item-table-wrap" aria-busy={loading}><table className="history-table"><thead><tr><th>{t("Customer ID")}</th><th>{t("Name")}</th><th>{t("Father's name")}</th><th>{t("Address")}</th><th>{t("Phone")}</th><th>{t("Aadhaar")}</th><th /></tr></thead><tbody>
      {loading ? <tr><td colSpan={7} className="empty">{t("Loading customers…")}</td></tr> : loadError ? <tr><td colSpan={7} className="empty">{t("Customer list could not be loaded.")}</td></tr> : customers.length ? customers.map(customer => <tr key={customer.id}><td><b>{customer.customerCode}</b></td><td><b>{customer.name}</b></td><td>{customer.fatherName}</td><td className="customer-address">{customer.address}</td><td>{customer.phone || "—"}</td><td>{customer.aadhaar ? `•••• •••• ${customer.aadhaar.slice(-4)}` : "—"}</td><td><button type="button" className="text-button" disabled={busy} onClick={() => edit(customer)} aria-label={`${t("Edit customer")} ${customer.name}`}>{t("Edit")}</button></td></tr>) : <tr><td colSpan={7} className="empty">{query ? t("No matching customers.") : t("No customers saved yet. Add your first customer above.")}</td></tr>}
    </tbody></table></div>
  </section>;
}
