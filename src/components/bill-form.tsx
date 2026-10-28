"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import type { Bill, BillInput, BillItemInput } from "@/lib/types";
import { formatINR } from "@/lib/money";
import { api } from "./api";
import { localStorageEnabled } from "@/lib/storage-mode";
import { jewelleryNameSchema, starterJewellery } from "@/lib/jewellery";

const addJewelleryOption = "\u0001add-jewellery";

const blankItem = (): BillItemInput => ({ particulars: "", grams: 0, assessedValue: 0, loanAmount: 0 });
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function BillForm({ onCreated, editingSource, accountSlot }: { onCreated: (bill: Bill) => void; editingSource?: Bill | null; accountSlot: AccountSlot }) {
  const [form, setForm] = useState<BillInput>(() => editingSource ? {
    billDate: editingSource.billDate, customerName: editingSource.customerName,
    fatherName: editingSource.fatherName, address: editingSource.address,
    phone: editingSource.phone,
    deliveryNo: editingSource.deliveryNo, deliveryDate: editingSource.deliveryDate,
    items: editingSource.items.map((item) => ({ ...item })),
  } : { billDate: today(), customerName: "", fatherName: "", address: "", phone: "", deliveryNo: "", deliveryDate: "", items: [blankItem()] });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [jewellery, setJewellery] = useState<string[]>([...starterJewellery]);
  const [catalogueError, setCatalogueError] = useState("");
  const [catalogueRefresh, setCatalogueRefresh] = useState(0);
  const [newJewellery, setNewJewellery] = useState<{ index: number; name: string } | null>(null);
  const [savingJewellery, setSavingJewellery] = useState(false);
  const [jewelleryError, setJewelleryError] = useState("");
  const [jewelleryNotice, setJewelleryNotice] = useState("");
  const particularsFields = useRef<(HTMLSelectElement | null)[]>([]);
  const catalogueGeneration = useRef(0);
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
  const set = <K extends keyof BillInput>(key: K, value: BillInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const item = (index: number, key: keyof BillItemInput, value: string) => setForm((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: key === "particulars" ? value : Number(value) } : row) }));
  const setMetal = (index: number, metal: "Gold" | "Silver") => setForm((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, metal } : row) }));
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
      item(newJewellery.index, "particulars", result.name);
      const index = newJewellery.index;
      setNewJewellery(null); setJewelleryNotice(`${result.name} saved to the jewellery list for all three accounts.`);
      window.requestAnimationFrame(() => particularsFields.current[index]?.focus());
    } catch (failure) { setJewelleryError(failure instanceof Error ? failure.message : "Unable to save jewellery. Please try again."); }
    finally { setSavingJewellery(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (newJewellery) { setJewelleryError("Save or cancel the new jewellery before saving the bill."); return; }
    setBusy(true); setError("");
    try { const path = editingSource ? `/api/bills/${editingSource.id}${localStorageEnabled ? "" : "/replace"}` : "/api/bills"; const { bill } = await api(path, accountSlot, { method: editingSource && localStorageEnabled ? "PATCH" : "POST", body: JSON.stringify(form) }); onCreated(bill); setForm({ billDate: today(), customerName: "", fatherName: "", address: "", phone: "", deliveryNo: "", deliveryDate: "", items: [blankItem()] }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to issue bill."); } finally { setBusy(false); }
  }
  return <section className="panel">
    <form onSubmit={submit}>
      <div className="section-heading bill-form-heading"><div><p className="eyebrow">{editingSource ? `ACCOUNT ${accountSlot} · ${localStorageEnabled ? "EDIT" : "REPLACE"} BILL #${editingSource.billNumber}` : `ACCOUNT ${accountSlot} · NEW BILL`}</p><h2>Customer and pledge details</h2>{editingSource && <p>{localStorageEnabled ? "Saving updates this bill without changing its number." : "Saving voids the original and issues a new bill number."}</p>}</div><label className="bill-date-field">Bill date<input type="date" value={form.billDate} onChange={(e) => set("billDate", e.target.value)} required /></label></div>
      <div className="form-grid"><label>Customer name<input value={form.customerName} onChange={(e) => set("customerName", e.target.value)} required /></label><label>Father&apos;s name<input value={form.fatherName} onChange={(e) => set("fatherName", e.target.value)} required /></label><label><span className="field-label">Mobile number <span className="muted">(optional)</span></span><input inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label><label className="wide">Address<textarea value={form.address} onChange={(e) => set("address", e.target.value)} required /></label></div>
      {catalogueError && <p className="error" role="alert">{catalogueError} <button type="button" className="text-button" onClick={() => setCatalogueRefresh(value => value + 1)}>Retry jewellery list</button></p>}
      <div className="item-table-wrap"><table className="item-table"><thead><tr>{localStorageEnabled && <th>Metal</th>}<th>Particulars</th><th>Gram</th><th>Assessed value (₹)</th><th>Loan amount (₹)</th><th /></tr></thead><tbody>{form.items.map((row, index) => <tr key={index}>
        {localStorageEnabled && <td><div className="metal-choice" role="group" aria-label={`Metal for item ${index + 1}`}>{(["Gold", "Silver"] as const).map((metal) => <label key={metal} className={row.metal === metal ? "selected" : ""}><input type="radio" name={`metal-${index}`} value={metal} checked={row.metal === metal} onChange={() => setMetal(index, metal)} required />{metal}</label>)}</div></td>}
        <td>{localStorageEnabled ? <div className="jewellery-picker">
          <select ref={element => { particularsFields.current[index] = element; }} aria-label={`Particulars for item ${index + 1}`} value={row.particulars} required disabled={busy || newJewellery !== null} onChange={event => {
            if (event.target.value === addJewelleryOption) startJewellery(index);
            else item(index, "particulars", event.target.value);
          }}>
            <option value="" disabled>Select jewellery</option>
            {row.particulars && !jewellery.includes(row.particulars) && <option value={row.particulars}>{row.particulars}</option>}
            {jewellery.map(name => <option key={name} value={name}>{name}</option>)}
            <option value={addJewelleryOption}>+ Add new jewellery…</option>
          </select>
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
        <td><input type="number" aria-label={`Gram for item ${index + 1}`} step="0.001" min="0" value={row.grams || ""} onChange={(e) => item(index, "grams", e.target.value)} required /></td>
        <td><div className="currency-input"><span aria-hidden="true">₹</span><input type="number" inputMode="decimal" aria-label={`Assessed value in rupees for item ${index + 1}`} step="0.01" min="0" value={row.assessedValue || ""} onChange={(e) => item(index, "assessedValue", e.target.value)} required /></div></td>
        <td><div className="currency-input"><span aria-hidden="true">₹</span><input type="number" inputMode="decimal" aria-label={`Loan amount in rupees for item ${index + 1}`} step="0.01" min="0" value={row.loanAmount || ""} onChange={(e) => item(index, "loanAmount", e.target.value)} required /></div></td>
        <td>{form.items.length > 1 && <button type="button" className="icon-button danger" aria-label="Remove item" disabled={busy || newJewellery !== null} onClick={() => set("items", form.items.filter((_, itemIndex) => itemIndex !== index))}>×</button>}</td>
      </tr>)}</tbody></table><button className="secondary" type="button" onClick={() => set("items", [...form.items, blankItem()])}>+ Add item</button></div>
      {jewelleryNotice && <p className="notice" role="status">{jewelleryNotice}</p>}
      <div className="total-bar"><span>Assessed total <strong>{formatINR(totals.value)}</strong></span><span>Loan total <strong>{formatINR(totals.loan)}</strong></span><button disabled={busy || newJewellery !== null}>{busy ? "Saving…" : editingSource ? localStorageEnabled ? "Save changes" : "Issue replacement" : "Issue bill"}</button></div>{error && <p className="error">{error}</p>}
    </form>
  </section>;
}
