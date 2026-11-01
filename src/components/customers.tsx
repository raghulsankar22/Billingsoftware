"use client";

import { useEffect, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import type { Customer, CustomerInput } from "@/lib/customers";
import { api } from "./api";

type SharedCustomer = Pick<Customer, "name" | "customerCode">;
const emptyCustomer = (): CustomerInput => ({ name: "", fatherName: "", address: "", phone: "", aadhaar: "" });

export function Customers({ accountSlot }: { accountSlot: AccountSlot }) {
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

  function reset() { setForm(emptyCustomer()); setEditingId(null); setCustomerCode(""); setError(""); }
  function edit(customer: Customer) {
    setForm({ name: customer.name, fatherName: customer.fatherName, address: customer.address, phone: customer.phone, aadhaar: customer.aadhaar });
    setEditingId(customer.id); setCustomerCode(customer.customerCode); setError(""); setNotice("");
    document.getElementById("customer-name")?.focus();
  }
  async function save(event?: React.FormEvent, allowSharedPhone = false) {
    event?.preventDefault();
    if (busy) return;
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
    <div className="section-heading"><div><p className="eyebrow">SHARED CUSTOMER DIRECTORY</p><h2>Customer</h2><p className="muted">One customer ID across every business account. Save details once and reuse them in any account&apos;s New bill.</p></div></div>
    <form onSubmit={save} className="customer-entry">
      <h3>{editingId ? "Edit customer" : "Add customer"}</h3>
      <p className="customer-code-note">{editingId ? `Customer ID: ${customerCode}` : "A unique customer ID will be assigned automatically when you save."}</p>
      <fieldset disabled={busy}>
        <div className="form-grid">
          <label htmlFor="customer-name">Customer name<input id="customer-name" value={form.name} minLength={2} maxLength={120} required onChange={e => setForm(current => ({ ...current, name: e.target.value }))} /></label>
          <label>Father&apos;s name<input value={form.fatherName} minLength={2} maxLength={120} required onChange={e => setForm(current => ({ ...current, fatherName: e.target.value }))} /></label>
          <label><span>Mobile number <span className="muted">(optional)</span></span><input type="tel" inputMode="tel" maxLength={20} placeholder="10-digit mobile number" value={form.phone} onChange={e => setForm(current => ({ ...current, phone: e.target.value }))} /></label>
          <label><span>Aadhaar <span className="muted">(optional)</span></span><input inputMode="numeric" maxLength={17} placeholder="12-digit Aadhaar number" value={form.aadhaar} onChange={e => setForm(current => ({ ...current, aadhaar: e.target.value }))} /></label>
          <label className="wide">Address<textarea value={form.address} minLength={5} maxLength={500} required onChange={e => setForm(current => ({ ...current, address: e.target.value }))} /></label>
        </div>
        <div className="customer-actions"><button>{busy ? "Saving…" : editingId ? "Save customer changes" : "Save customer"}</button>{editingId && <button type="button" className="secondary" onClick={reset}>Cancel edit</button>}</div>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      {sharedPhone && <div className="overview-warning" role="alert"><p>This phone is already saved for <b>{sharedPhone.name}</b> ({sharedPhone.customerCode}). Is this a different person, such as a family member?</p><div className="customer-actions"><button type="button" disabled={busy} onClick={() => void save(undefined, true)}>Yes, save as a new customer</button><button type="button" className="secondary" disabled={busy} onClick={() => setSharedPhone(null)}>No, go back</button></div></div>}
      {notice && <p className="notice" role="status">{notice}</p>}
    </form>
    <div className="section-heading customer-list-heading"><h3>Saved customers</h3><label className="customer-search">Search customers<input type="search" placeholder="Customer ID, name, phone or Aadhaar" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
    {loadError && <p className="error" role="alert">{loadError} <button type="button" className="text-button" onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
    <div className="item-table-wrap" aria-busy={loading}><table className="history-table"><thead><tr><th>Customer ID</th><th>Name</th><th>Father&apos;s name</th><th>Address</th><th>Phone</th><th>Aadhaar</th><th /></tr></thead><tbody>
      {loading ? <tr><td colSpan={7} className="empty">Loading customers…</td></tr> : loadError ? <tr><td colSpan={7} className="empty">Customer list could not be loaded.</td></tr> : customers.length ? customers.map(customer => <tr key={customer.id}><td><b>{customer.customerCode}</b></td><td><b>{customer.name}</b></td><td>{customer.fatherName}</td><td className="customer-address">{customer.address}</td><td>{customer.phone || "—"}</td><td>{customer.aadhaar ? `•••• •••• ${customer.aadhaar.slice(-4)}` : "—"}</td><td><button type="button" className="text-button" disabled={busy} onClick={() => edit(customer)} aria-label={`Edit customer ${customer.name}`}>Edit</button></td></tr>) : <tr><td colSpan={7} className="empty">{query ? "No matching customers." : "No customers saved yet. Add your first customer above."}</td></tr>}
    </tbody></table></div>
  </section>;
}
