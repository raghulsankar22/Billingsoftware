"use client";

import { useLanguage } from "./language-provider";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import type { Bill, BillInput, BillItemInput } from "@/lib/types";
import { sharedPhoneQuestion, type Customer } from "@/lib/customers";
import { capitalizeWords, holdCaret } from "@/lib/text-case";
import { assessedValueForLoan, formatINR } from "@/lib/money";
import { api } from "./api";
import { localStorageEnabled } from "@/lib/storage-mode";
import { appendJewelleryParticulars, jewelleryNameSchema, starterJewellery } from "@/lib/jewellery";
import { ZodError } from "zod";
import { EnglishRecordField } from "./english-record-field";
import { JewelleryRemarks } from "./jewellery-remarks";

const addJewelleryOption = "\u0001add-jewellery";

const blankItem = (): BillItemInput => ({ particulars: "", remarks: "", grams: 0, assessedValue: 0, loanAmount: 0 });
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function BillForm({ onCreated, editingSource, accountSlot }: { onCreated: (bill: Bill) => void; editingSource?: Bill | null; accountSlot: AccountSlot }) {
  const { t } = useLanguage();
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
  const [phoneChoices, setPhoneChoices] = useState<Customer[]>([]);
  const [differentPerson, setDifferentPerson] = useState(false);
  const customerLookupGeneration = useRef(0);
  const filledCustomer = useRef<Customer | null>(null);
  function fillCustomer(customer: Customer) {
    setForm(current => ({ ...current, customerName: customer.name, fatherName: customer.fatherName, address: customer.address, phone: customer.phone, governmentId: customer.aadhaar, customerId: customer.id }));
    setCustomerCode(customer.customerCode);
    filledCustomer.current = customer;
    setDifferentPerson(false);
    setPhoneChoices([]);
    setCustomerNotice(`Details filled from saved customer: ${customer.name}.`);
  }
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
          // A phone can belong to several family members, so staff pick the person.
          const matches: Customer[] = result.matches ?? [];
          if (matches.length) { setPhoneChoices(matches); setCustomerNotice("This phone is saved for the customer below. Is it the same person?"); return; }
          const customer: Customer | null = result.customer;
          if (!customer) { setCustomerNotice("No saved customer found. Enter the details below. A new customer ID is created when you save the bill."); return; }
          fillCustomer(customer);
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
  const set = <K extends keyof BillInput>(key: K, input: BillInput[K]) => {
    let value = input;
    if (key === "customerName" || key === "fatherName" || key === "address") {
      value = capitalizeWords(String(input)) as BillInput[K]; holdCaret();
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
    setCustomerCode(""); setPhoneChoices([]); setDifferentPerson(false);
    setForm(current => ({ ...current, ...(previous ? { customerName: "", fatherName: "", address: "", phone: "", governmentId: "" } : {}), customerId: "", [field === "phone" ? "phone" : "governmentId"]: value }));
    setCustomerLookup({ field, value });
  }
  // Imported bills keep unrecorded details blank, and a guessed value is never filled in for them.
  const keepsBlanks = editingSource?.historicalMissingDetails === true;
  const item = (index: number, key: keyof BillItemInput, value: string) => { if (key === "particulars") holdCaret(); setForm((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: key === "particulars" ? capitalizeWords(value) : key === "remarks" ? value : keepsBlanks && value === "" && key !== "loanAmount" ? null : Number(value), ...(key === "loanAmount" && !keepsBlanks ? { assessedValue: assessedValueForLoan(Number(value)) } : {}) } : row) })); };
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
    const review = document.getElementById(`new-jewellery-${newJewellery.index}`) as HTMLInputElement | null;
    if (review && !review.reportValidity()) return;
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
    if (!(event.currentTarget as HTMLFormElement).reportValidity()) return;
    if (lookingUpCustomer) return;
    if (localStorageEnabled && form.governmentId && form.governmentId !== editingSource?.governmentId && !/^\d{12}$/.test(form.governmentId.replace(/[\s-]/g, ""))) { setError("Enter a 12-digit Aadhaar number, or leave it empty."); return; }
    if (newJewellery) { setJewelleryError("Save or cancel the new jewellery before saving the bill."); return; }
    if (localStorageEnabled && Object.values(jewelleryDrafts).some(draft => draft.name)) { setError("Click Add beside each selected jewellery to include it in Particulars before saving the bill."); return; }
    setBusy(true); setError("");
    try { const path = editingSource ? `/api/bills/${editingSource.id}${localStorageEnabled ? "" : "/replace"}` : "/api/bills"; const { bill } = await api(path, accountSlot, { method: editingSource && localStorageEnabled ? "PATCH" : "POST", body: JSON.stringify({ ...form, ...(differentPerson ? { allowSharedPhone: true } : {}), ...(localStorageEnabled ? { governmentId: editingSource && form.governmentId === editingSource.governmentId ? form.governmentId : (form.governmentId ?? "").replace(/[\s-]/g, "") } : {}) }) }); onCreated(bill); filledCustomer.current = null; setDifferentPerson(false); setCustomerLookup(null); setCustomerNotice(""); setJewelleryDrafts({}); setForm({ billDate: today(), customerName: "", fatherName: "", address: "", phone: "", governmentId: "", deliveryNo: "", deliveryDate: "", items: [blankItem()] }); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to issue bill.");
      // Show who already has this phone, so staff can pick them or say it's someone else.
      if (failure instanceof Error && failure.message.includes(sharedPhoneQuestion)) setCustomerLookup({ field: "phone", value: form.phone });
    } finally { setBusy(false); }
  }
  return <section className="panel">
    <form onSubmit={submit}>
      <div className="section-heading bill-form-heading"><div><p className="eyebrow">{editingSource ? `${t("ACCOUNT")} ${accountSlot} · ${t(localStorageEnabled ? "Edit bill" : "Replace bill")} #${editingSource.billNumber}` : `${t("ACCOUNT")} ${accountSlot} · ${t("New bill")}`}</p><h2>{t("Customer and pledge details")}</h2>{editingSource && <p>{localStorageEnabled ? t("Saving updates this bill without changing its number.") : t("Saving voids the original and issues a new bill number.")}</p>}{keepsBlanks && <p className="muted">{t("Imported from your old register. Details you leave blank stay \"Not recorded\".")}</p>}</div><label className="bill-date-field">{t("Bill date")}<input type="date" value={form.billDate} onChange={(e) => set("billDate", e.target.value)} required /></label></div>
      {localStorageEnabled && <p className="muted customer-lookup-help">{t("Enter a saved customer's Aadhaar to fill their details automatically, or their mobile number to choose them.")}</p>}
      <div className="form-grid customer-details-grid">
        <EnglishRecordField label="Customer name" googleField="customerName" value={form.customerName} onChange={value => set("customerName", value)} required disabled={busy} maxLength={120} />
        <EnglishRecordField label="Father's name" googleField="fatherName" value={form.fatherName} onChange={value => set("fatherName", value)} required={!keepsBlanks} disabled={busy} maxLength={120} />
        <label><span className="field-label">{t("Mobile number")} <span className="muted">{t("(optional)")}</span></span><input inputMode="tel" aria-label={t("Customer mobile number")} value={form.phone} disabled={busy} onChange={e => setIdentifier("phone", e.target.value)} /></label>
        {localStorageEnabled && <label><span className="field-label">{t("Aadhaar")} <span className="muted">{t("(optional)")}</span></span><input inputMode="numeric" aria-label={t("Customer Aadhaar")} maxLength={17} value={form.governmentId ?? ""} disabled={busy} onChange={e => setIdentifier("aadhaar", e.target.value)} /></label>}
        {localStorageEnabled && <label className="wide customer-code-field">{t("Customer ID")}<input aria-label={t("Customer ID")} value={customerCode} readOnly placeholder={t("Created automatically when the bill is saved")} /></label>}
        <EnglishRecordField label="Address" googleField="address" multiline className="wide" value={form.address} onChange={value => set("address", value)} required={!keepsBlanks} disabled={busy} maxLength={500} />
      </div>
      {customerNotice && <p className="notice customer-lookup-notice" role="status">{t(customerNotice)}</p>}
      {phoneChoices.length > 0 && <div className="form-actions" role="group" aria-label={t("Choose saved customer")}>{phoneChoices.map(customer => <button type="button" className="secondary" key={customer.id} disabled={busy} onClick={() => fillCustomer(customer)}>{t("Use")} {customer.name}{t(", father")} {customer.fatherName} ({customer.customerCode})</button>)}<button type="button" className="secondary" disabled={busy} onClick={() => { setPhoneChoices([]); setDifferentPerson(true); setCustomerNotice("Enter this customer's details below."); }}>{t("A different person")}</button></div>}
      {catalogueError && <p className="error" role="alert">{catalogueError} <button type="button" className="text-button" onClick={() => setCatalogueRefresh(value => value + 1)}>{t("Retry jewellery list")}</button></p>}
      <div className="item-table-wrap"><table className="item-table"><thead><tr>{localStorageEnabled && <th>{t("Metal")}</th>}<th>{t("Particulars")}</th>{localStorageEnabled && <th>{t("Remarks")} <span className="muted">{t("(optional)")}</span></th>}<th>{t("Gram")}</th><th>{t("Loan amount (₹)")}</th><th>{t("Assessed value (₹)")}</th><th /></tr></thead><tbody>{form.items.map((row, index) => <tr key={index}>
        {localStorageEnabled && <td><div className="metal-choice" role="group" aria-label={`${t("Metal for item")} ${index + 1}`}>{(["Gold", "Silver"] as const).map((metal) => <label key={metal} className={row.metal === metal ? "selected" : ""}><input type="radio" name={`metal-${index}`} value={metal} checked={row.metal === metal} onChange={() => setMetal(index, metal)} required />{t(metal)}</label>)}</div></td>}
        <td>{localStorageEnabled ? <div className="jewellery-picker">
          <EnglishRecordField label="Particulars" multiline maxLength={180} value={row.particulars} required disabled={busy} onChange={value => item(index, "particulars", value)} />
          <div className="jewellery-entry-controls"><label>{t("Jewellery")}<select ref={element => { particularsFields.current[index] = element; }} aria-label={`${t("Jewellery to add for item")} ${index + 1}`} value={jewelleryDrafts[index]?.name ?? ""} disabled={busy || newJewellery !== null} onChange={event => {
            if (event.target.value === addJewelleryOption) startJewellery(index);
            else setJewelleryDraft(index, { name: event.target.value });
          }}>
            <option value="">{t("Select jewellery")}</option>
            {jewellery.map(name => <option key={name} value={name}>{starterJewellery.some(known => known === name) ? t(name) : name}</option>)}
            <option value={addJewelleryOption}>{t("+ Add new jewellery…")}</option>
          </select></label><label>{t("Qty")}<input type="number" aria-label={`${t("Jewellery quantity for item")} ${index + 1}`} min="1" max="9999" step="1" value={jewelleryDrafts[index]?.quantity ?? "1"} disabled={busy || newJewellery !== null || !jewelleryDrafts[index]?.name} onChange={event => setJewelleryDraft(index, { quantity: event.target.value })} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addToParticulars(index); } }} /></label><button type="button" aria-label={`${t("Add jewellery to particulars for item")} ${index + 1}`} disabled={busy || newJewellery !== null} onClick={() => addToParticulars(index)}>{t("Add")}</button></div>
          <small className="muted">{t("Choose jewellery and quantity, then Add. Repeat for more items. Gram and amounts are totals for this row.")}</small>
          {jewelleryDrafts[index]?.error && <p className="error" role="alert">{t(jewelleryDrafts[index].error)}</p>}
          <button type="button" className="text-button jewellery-add-button" disabled={busy || newJewellery !== null} onClick={() => startJewellery(index)}>{t("+ Add new jewellery")}</button>
          {newJewellery?.index === index && <div className="jewellery-add" role="group" aria-label={`${t("Add jewellery for item")} ${index + 1}`}>
            <EnglishRecordField label="New jewellery name" id={`new-jewellery-${index}`} autoFocus value={newJewellery.name} disabled={savingJewellery} maxLength={180} onChange={value => { setNewJewellery({ index, name: value }); setJewelleryError(""); }} />
            <div className="jewellery-add-actions"><button type="button" disabled={savingJewellery} onClick={() => void saveJewellery()}>{savingJewellery ? t("Saving…") : t("Save jewellery")}</button><button type="button" className="secondary" disabled={savingJewellery} onClick={cancelJewellery}>{t("Cancel")}</button></div>
            {jewelleryError && <p className="error" id={`jewellery-error-${index}`} role="alert">{t(jewelleryError)}</p>}
          </div>}
        </div> : <input aria-label={`${t("Particulars for item")} ${index + 1}`} value={row.particulars} onChange={event => item(index, "particulars", event.target.value)} required />}</td>
        {localStorageEnabled && <td><JewelleryRemarks index={index} value={row.remarks} disabled={busy} onChange={value => item(index, "remarks", value)} /></td>}
        <td><input type="number" aria-label={`${t("Gram for item")} ${index + 1}`} step="0.001" min="0" value={row.grams || ""} onChange={(e) => item(index, "grams", e.target.value)} required={!keepsBlanks} /></td>
        <td><div className="currency-input"><span aria-hidden="true">₹</span><input type="number" inputMode="decimal" aria-label={`${t("Loan amount in rupees for item")} ${index + 1}`} step="0.01" min="0" value={row.loanAmount || ""} onChange={(e) => item(index, "loanAmount", e.target.value)} required /></div></td>
        <td><div className="currency-input"><span aria-hidden="true">₹</span><input type="number" inputMode="decimal" aria-label={`${t("Assessed value in rupees for item")} ${index + 1}`} step="0.01" min="0" value={row.assessedValue || ""} readOnly={!keepsBlanks} onChange={event => item(index, "assessedValue", event.target.value)} required={!keepsBlanks} /></div><small className="assessed-note muted">{keepsBlanks ? t("Leave blank if not recorded") : row.assessedValue === assessedValueForLoan(row.loanAmount) ? t("Loan + 10%") : t("Saved assessed value")}</small></td>
        <td>{form.items.length > 1 && <button type="button" className="icon-button danger" aria-label={t("Remove item")} disabled={busy || newJewellery !== null} onClick={() => removeItem(index)}>×</button>}</td>
      </tr>)}</tbody></table></div>
      {jewelleryNotice && <p className="notice" role="status">{t(jewelleryNotice)}</p>}
      <div className="total-bar"><span>{t("Loan total")} <strong>{formatINR(totals.loan)}</strong></span><span>{t("Assessed total")} <strong>{formatINR(totals.value)}</strong></span><button disabled={busy || lookingUpCustomer || newJewellery !== null}>{busy ? t("Saving…") : editingSource ? localStorageEnabled ? t("Save changes") : t("Issue replacement") : t("Issue bill")}</button></div>{error && <p className="error">{t(error)}</p>}
    </form>
  </section>;
}
