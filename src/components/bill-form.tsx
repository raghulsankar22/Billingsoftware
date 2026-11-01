"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import type { Bill, BillInput, BillItemInput } from "@/lib/types";
import type { Customer } from "@/lib/customers";
import { assessedValueForLoan, formatINR } from "@/lib/money";
import { api } from "./api";
import { localStorageEnabled } from "@/lib/storage-mode";
import { appendJewelleryParticulars, jewelleryNameSchema, starterJewellery } from "@/lib/jewellery";
import { ZodError } from "zod";
import { JewelleryRemarks } from "./jewellery-remarks";

const addJewelleryOption = "\u0001add-jewellery";

const blankItem = (): BillItemInput => ({ particulars: "", remarks: "", grams: 0, assessedValue: 0, loanAmount: 0 });
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function BillForm({ onCreated, editingSource, accountSlot }: { onCreated: (bill: Bill) => void; editingSource?: Bill | null; accountSlot: AccountSlot }) {
  const [form, setForm] = useState<BillInput>(() => editingSource ? {
    billDate: editingSource.billDate, customerName: editingSource.customerName,
    fatherName: editingSource.fatherName, address: editingSource.address,
    phone: editingSource.phone, governmentId: editingSource.governmentId ?? "", customerId: editingSource.customerId ?? "",
    deliveryNo: editingSource.deliveryNo, deliveryDate: editingSource.deliveryDate,
    items: editingSource.items.map((item) => ({ ...item })),
  } : { billDate: today(), customerName: "", fatherName: "", address: "", phone: "", governmentId: "", customerId: "", deliveryNo: "", deliveryDate: "", items: [blankItem()] });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [customerLookup, setCustomerLookup] = useState<{ field: "phone" | "aadhaar"; value: string } | null>(null);
  const [customerNotice, setCustomerNotice] = useState("");
  const [customerCode, setCustomerCode] = useState(editingSource?.customerCode ?? "");
  const [lookingUpCustomer, setLookingUpCustomer] = useState(false);
  const customerLookupGeneration = useRef(0);
  const filledCustomer = useRef<Customer | null>(null);
  const [jewellery, setJewellery] = useState<string[]>([...starterJewellery]);
  const [catalogueError, setCatalogueError] = useState("");
  const [catalogueRefresh, setCatalogueRefresh] = useState(0);
  const [newJewellery, setNewJewellery] = useState<{ index: number; name: string } | null>(null);
  const [savingJewellery, setSavingJewellery] = useState(false);
  const [jewelleryError, setJewelleryError] = useState("");
  const [jewelleryNotice, setJewelleryNotice] = useState("");
  const [jewelleryDrafts, setJewelleryDrafts] = useState<Record<number, { name: string; quantity: string; error: string }>>({});
  const particularsFields = useRef<(HTMLSelectElement | null)[]>([]);
  const catalogueGeneration = useRef(0);
  useEffect(() => {
    if (!localStorageEnabled || !customerLookup) { setCustomerNotice(""); setLookingUpCustomer(false); return; }
    const digits = customerLookup.value.replace(/\D/g, "");
    const ready = customerLookup.field === "aadhaar" ? digits.length === 12 : digits.length === 10 || (digits.length === 12 && digits.startsWith("91"));
    if (!ready) { setCustomerNotice(""); setLookingUpCustomer(false); return; }
    let active = true;
    const generation = ++customerLookupGeneration.current;
    setLookingUpCustomer(true); setCustomerNotice("Looking for saved customer…");
    const timer = window.setTimeout(() => {
      api(`/api/customers?${customerLookup.field}=${encodeURIComponent(customerLookup.value)}`, accountSlot)
        .then(result => {
          if (!active || generation !== customerLookupGeneration.current) return;
          const customer: Customer | null = result.customer;
          if (!customer) { setCustomerNotice("No saved customer found. Enter the details below, or add the customer in the Customer tab."); return; }
          setForm(current => ({ ...current, customerName: customer.name, fatherName: customer.fatherName, address: customer.address, phone: customer.phone, governmentId: customer.aadhaar, customerId: customer.id }));
          setCustomerCode(customer.customerCode);
          filledCustomer.current = customer;
          setCustomerNotice(`Details filled from saved customer: ${customer.name}.`);
        })
        .catch(failure => { if (active && generation === customerLookupGeneration.current) setCustomerNotice(failure instanceof Error ? failure.message : "Unable to find customer. You can enter the details manually."); })
        .finally(() => { if (active && generation === customerLookupGeneration.current) setLookingUpCustomer(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [accountSlot, customerLookup]);
  useEffect(() => {
    if (!localStorageEnabled) return;
    const generation = ++catalogueGeneration.current;
    let active = true;
    api("/api/jewellery", accountSlot).then(result => {
      if (active && generation === catalogueGeneration.current) { setJewellery(result.items); setCatalogueError(""); }
    }).catch(() => {
      if (active && generation === catalogueGeneration.current) setCatalogueError("Your saved jewellery list could not be loaded. Starter items are still available.");
    });
    return () => { active = false; };
  }, [accountSlot, catalogueRefresh]);
  const totals = useMemo(() => form.items.reduce((sum, item) => ({ value: sum.value + Number(item.assessedValue || 0), loan: sum.loan + Number(item.loanAmount || 0) }), { value: 0, loan: 0 }), [form.items]);
  const set = <K extends keyof BillInput>(key: K, value: BillInput[K]) => {
    if (key === "customerName" || key === "fatherName" || key === "address") {
      customerLookupGeneration.current++; filledCustomer.current = null;
      setCustomerCode("");
      setCustomerLookup(null); setLookingUpCustomer(false); setCustomerNotice("");
    }
    setForm(current => ({ ...current, [key]: value, ...(["customerName", "fatherName", "address"].includes(key) ? { customerId: "" } : {}) }));
  };
  function setIdentifier(field: "phone" | "aadhaar", value: string) {
    customerLookupGeneration.current++;
    const previous = filledCustomer.current;
    filledCustomer.current = null;
    setCustomerCode("");
    setForm(current => ({ ...current, ...(previous ? { customerName: "", fatherName: "", address: "", phone: "", governmentId: "" } : {}), customerId: "", [field === "phone" ? "phone" : "governmentId"]: value }));
    setCustomerLookup({ field, value });
  }
  // Imported bills keep unrecorded details blank, and a guessed value is never filled in for them.
  const keepsBlanks = editingSource?.historicalMissingDetails === true;
  const item = (index: number, key: keyof BillItemInput, value: string) => setForm((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: key === "particulars" || key === "remarks" ? value : keepsBlanks && value === "" && key !== "loanAmount" ? null : Number(value), ...(key === "loanAmount" && !keepsBlanks ? { assessedValue: assessedValueForLoan(Number(value)) } : {}) } : row) }));
  const setMetal = (index: number, metal: "Gold" | "Silver") => setForm((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, metal } : row) }));
  function setJewelleryDraft(index: number, patch: { name?: string; quantity?: string; error?: string }) {
    setJewelleryDrafts(current => {
      const draft = current[index] ?? { name: "", quantity: "1", error: "" };
      return { ...current, [index]: { ...draft, error: "", ...patch } };
    });
  }
  function addToParticulars(index: number) {
    const draft = jewelleryDrafts[index];
    if (!draft?.name) { setJewelleryDraft(index, { error: "Select jewellery to add." }); return; }
    try {
      item(index, "particulars", appendJewelleryParticulars(form.items[index].particulars, draft.name, draft.quantity));
      setJewelleryDraft(index, { name: "", quantity: "1" }); setError("");
      window.requestAnimationFrame(() => particularsFields.current[index]?.focus());
    } catch (failure) {
      setJewelleryDraft(index, { error: failure instanceof ZodError ? failure.issues[0].message : failure instanceof Error ? failure.message : "Unable to add jewellery." });
    }
  }
  function removeItem(index: number) {
    set("items", form.items.filter((_, rowIndex) => rowIndex !== index));
    setJewelleryDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => Number(key) !== index).map(([key, value]) => [Number(key) > index ? Number(key) - 1 : Number(key), value])));
  }
  function startJewellery(index: number) {
    setNewJewellery({ index, name: "" }); setJewelleryError(""); setJewelleryNotice("");
  }
  function cancelJewellery() {
    if (savingJewellery || !newJewellery) return;
    const index = newJewellery.index;
    setNewJewellery(null); setJewelleryError("");
    window.requestAnimationFrame(() => particularsFields.current[index]?.focus());
  }
  async function saveJewellery() {
    if (!newJewellery || savingJewellery) return;
    const parsed = jewelleryNameSchema.safeParse(newJewellery.name);
    if (!parsed.success) { setJewelleryError(parsed.error.issues[0].message); return; }
    setSavingJewellery(true); setJewelleryError("");
    try {
      const result = await api("/api/jewellery", accountSlot, { method: "POST", body: JSON.stringify({ name: parsed.data }) });
      catalogueGeneration.current++;
      setJewellery(result.items); setCatalogueError("");
      setJewelleryDraft(newJewellery.index, { name: result.name });
      const index = newJewellery.index;
      setNewJewellery(null); setJewelleryNotice(`${result.name} saved. Enter its quantity and click Add to include it in Particulars.`);
      window.requestAnimationFrame(() => particularsFields.current[index]?.focus());
    } catch (failure) { setJewelleryError(failure instanceof Error ? failure.message : "Unable to save jewellery. Please try again."); }
    finally { setSavingJewellery(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lookingUpCustomer) return;
    if (localStorageEnabled && form.governmentId && form.governmentId !== editingSource?.governmentId && !/^\d{12}$/.test(form.governmentId.replace(/[\s-]/g, ""))) { setError("Enter a 12-digit Aadhaar number, or leave it empty."); return; }
    if (newJewellery) { setJewelleryError("Save or cancel the new jewellery before saving the bill."); return; }
    if (localStorageEnabled && Object.values(jewelleryDrafts).some(draft => draft.name)) { setError("Click Add beside each selected jewellery to include it in Particulars before saving the bill."); return; }
    setBusy(true); setError("");
    try { const path = editingSource ? `/api/bills/${editingSource.id}${localStorageEnabled ? "" : "/replace"}` : "/api/bills"; const { bill } = await api(path, accountSlot, { method: editingSource && localStorageEnabled ? "PATCH" : "POST", body: JSON.stringify({ ...form, ...(localStorageEnabled ? { governmentId: editingSource && form.governmentId === editingSource.governmentId ? form.governmentId : (form.governmentId ?? "").replace(/[\s-]/g, "") } : {}) }) }); onCreated(bill); filledCustomer.current = null; setCustomerLookup(null); setCustomerNotice(""); setJewelleryDrafts({}); setForm({ billDate: today(), customerName: "", fatherName: "", address: "", phone: "", governmentId: "", deliveryNo: "", deliveryDate: "", items: [blankItem()] }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to issue bill."); } finally { setBusy(false); }
  }
  return <section className="panel">
    <form onSubmit={submit}>
      <div className="section-heading bill-form-heading"><div><p className="eyebrow">{editingSource ? `ACCOUNT ${accountSlot} · ${localStorageEnabled ? "EDIT" : "REPLACE"} BILL #${editingSource.billNumber}` : `ACCOUNT ${accountSlot} · NEW BILL`}</p><h2>Customer and pledge details</h2>{editingSource && <p>{localStorageEnabled ? "Saving updates this bill without changing its number." : "Saving voids the original and issues a new bill number."}</p>}{keepsBlanks && <p className="muted">Imported from your old register. Details you leave blank stay &quot;Not recorded&quot;.</p>}</div><label className="bill-date-field">Bill date<input type="date" value={form.billDate} onChange={(e) => set("billDate", e.target.value)} required /></label></div>
      {localStorageEnabled && <p className="muted customer-lookup-help">Enter a saved customer&apos;s mobile number or Aadhaar to fill their details automatically.</p>}
      <div className="form-grid customer-details-grid">
        <label>Customer name<input aria-label="Customer name" value={form.customerName} onChange={(e) => set("customerName", e.target.value)} required /></label>
        <label>Father&apos;s name<input aria-label="Customer father's name" value={form.fatherName} onChange={(e) => set("fatherName", e.target.value)} required={!keepsBlanks} /></label>
        <label><span className="field-label">Mobile number <span className="muted">(optional)</span></span><input inputMode="tel" aria-label="Customer mobile number" value={form.phone} disabled={busy} onChange={e => setIdentifier("phone", e.target.value)} /></label>
        {localStorageEnabled && <label><span className="field-label">Aadhaar <span className="muted">(optional)</span></span><input inputMode="numeric" aria-label="Customer Aadhaar" maxLength={17} value={form.governmentId ?? ""} disabled={busy} onChange={e => setIdentifier("aadhaar", e.target.value)} /></label>}
        {localStorageEnabled && <label className="wide customer-code-field">Customer ID<input aria-label="Customer ID" value={customerCode} readOnly placeholder="Filled automatically from a saved customer" /></label>}
        <label className="wide">Address<textarea aria-label="Customer address" value={form.address} onChange={(e) => set("address", e.target.value)} required={!keepsBlanks} /></label>
      </div>
      {customerNotice && <p className="notice customer-lookup-notice" role="status">{customerNotice}</p>}
      {catalogueError && <p className="error" role="alert">{catalogueError} <button type="button" className="text-button" onClick={() => setCatalogueRefresh(value => value + 1)}>Retry jewellery list</button></p>}
      <div className="item-table-wrap"><table className="item-table"><thead><tr>{localStorageEnabled && <th>Metal</th>}<th>Particulars</th>{localStorageEnabled && <th>Remarks <span className="muted">(optional)</span></th>}<th>Gram</th><th>Loan amount (₹)</th><th>Assessed value (₹)</th><th /></tr></thead><tbody>{form.items.map((row, index) => <tr key={index}>
        {localStorageEnabled && <td><div className="metal-choice" role="group" aria-label={`Metal for item ${index + 1}`}>{(["Gold", "Silver"] as const).map((metal) => <label key={metal} className={row.metal === metal ? "selected" : ""}><input type="radio" name={`metal-${index}`} value={metal} checked={row.metal === metal} onChange={() => setMetal(index, metal)} required />{metal}</label>)}</div></td>}
        <td>{localStorageEnabled ? <div className="jewellery-picker">
          <textarea aria-label={`Particulars for item ${index + 1}`} placeholder="e.g. Ring 2, Studs 1" maxLength={180} value={row.particulars} required disabled={busy} onChange={event => item(index, "particulars", event.target.value)} />
          <div className="jewellery-entry-controls"><label>Jewellery<select ref={element => { particularsFields.current[index] = element; }} aria-label={`Jewellery to add for item ${index + 1}`} value={jewelleryDrafts[index]?.name ?? ""} disabled={busy || newJewellery !== null} onChange={event => {
            if (event.target.value === addJewelleryOption) startJewellery(index);
            else setJewelleryDraft(index, { name: event.target.value });
          }}>
            <option value="">Select jewellery</option>
            {jewellery.map(name => <option key={name} value={name}>{name}</option>)}
            <option value={addJewelleryOption}>+ Add new jewellery…</option>
          </select></label><label>Qty<input type="number" aria-label={`Jewellery quantity for item ${index + 1}`} min="1" max="9999" step="1" value={jewelleryDrafts[index]?.quantity ?? "1"} disabled={busy || newJewellery !== null || !jewelleryDrafts[index]?.name} onChange={event => setJewelleryDraft(index, { quantity: event.target.value })} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addToParticulars(index); } }} /></label><button type="button" aria-label={`Add jewellery to particulars for item ${index + 1}`} disabled={busy || newJewellery !== null} onClick={() => addToParticulars(index)}>Add</button></div>
          <small className="muted">Choose jewellery and quantity, then Add. Repeat for more items. Gram and amounts are totals for this row.</small>
          {jewelleryDrafts[index]?.error && <p className="error" role="alert">{jewelleryDrafts[index].error}</p>}
          <button type="button" className="text-button jewellery-add-button" disabled={busy || newJewellery !== null} onClick={() => startJewellery(index)}>+ Add new jewellery</button>
          {newJewellery?.index === index && <div className="jewellery-add" role="group" aria-label={`Add jewellery for item ${index + 1}`}>
            <label htmlFor={`new-jewellery-${index}`}>New jewellery name</label>
            <input id={`new-jewellery-${index}`} autoFocus maxLength={180} value={newJewellery.name} placeholder="e.g. Jhumka" disabled={savingJewellery} aria-describedby={jewelleryError ? `jewellery-error-${index}` : undefined} onChange={event => { setNewJewellery({ index, name: event.target.value }); setJewelleryError(""); }} onKeyDown={event => {
              if (event.key === "Enter") { event.preventDefault(); void saveJewellery(); }
              if (event.key === "Escape") { event.preventDefault(); cancelJewellery(); }
            }} />
            <div className="jewellery-add-actions"><button type="button" disabled={savingJewellery} onClick={() => void saveJewellery()}>{savingJewellery ? "Saving…" : "Save jewellery"}</button><button type="button" className="secondary" disabled={savingJewellery} onClick={cancelJewellery}>Cancel</button></div>
            {jewelleryError && <p className="error" id={`jewellery-error-${index}`} role="alert">{jewelleryError}</p>}
          </div>}
        </div> : <input aria-label={`Particulars for item ${index + 1}`} value={row.particulars} onChange={event => item(index, "particulars", event.target.value)} required />}</td>
        {localStorageEnabled && <td><JewelleryRemarks index={index} value={row.remarks} disabled={busy} onChange={value => item(index, "remarks", value)} /></td>}
        <td><input type="number" aria-label={`Gram for item ${index + 1}`} step="0.001" min="0" value={row.grams || ""} onChange={(e) => item(index, "grams", e.target.value)} required={!keepsBlanks} /></td>
        <td><div className="currency-input"><span aria-hidden="true">₹</span><input type="number" inputMode="decimal" aria-label={`Loan amount in rupees for item ${index + 1}`} step="0.01" min="0" value={row.loanAmount || ""} onChange={(e) => item(index, "loanAmount", e.target.value)} required /></div></td>
        <td><div className="currency-input"><span aria-hidden="true">₹</span><input type="number" inputMode="decimal" aria-label={`Assessed value in rupees for item ${index + 1}`} step="0.01" min="0" value={row.assessedValue || ""} readOnly={!keepsBlanks} onChange={event => item(index, "assessedValue", event.target.value)} required={!keepsBlanks} /></div><small className="assessed-note muted">{keepsBlanks ? "Leave blank if not recorded" : row.assessedValue === assessedValueForLoan(row.loanAmount) ? "Loan + 10%" : "Saved assessed value"}</small></td>
        <td>{form.items.length > 1 && <button type="button" className="icon-button danger" aria-label="Remove item" disabled={busy || newJewellery !== null} onClick={() => removeItem(index)}>×</button>}</td>
      </tr>)}</tbody></table></div>
      {jewelleryNotice && <p className="notice" role="status">{jewelleryNotice}</p>}
      <div className="total-bar"><span>Loan total <strong>{formatINR(totals.loan)}</strong></span><span>Assessed total <strong>{formatINR(totals.value)}</strong></span><button disabled={busy || lookingUpCustomer || newJewellery !== null}>{busy ? "Saving…" : editingSource ? localStorageEnabled ? "Save changes" : "Issue replacement" : "Issue bill"}</button></div>{error && <p className="error">{error}</p>}
    </form>
  </section>;
}
