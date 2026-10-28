"use client";

import { useMemo, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import type { Bill, BillInput, BillItemInput } from "@/lib/types";
import { formatINR } from "@/lib/money";
import { api } from "./api";

const blankItem = (): BillItemInput => ({ particulars: "", grams: 0, assessedValue: 0, loanAmount: 0 });
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export function BillForm({ onCreated, replacementSource, accountSlot }: { onCreated: (bill: Bill) => void; replacementSource?: Bill | null; accountSlot: AccountSlot }) {
  const [form, setForm] = useState<BillInput>(() => replacementSource ? {
    billDate: today(), customerName: replacementSource.customerName,
    fatherName: replacementSource.fatherName, address: replacementSource.address,
    phone: replacementSource.phone,
    deliveryNo: replacementSource.deliveryNo, deliveryDate: replacementSource.deliveryDate,
    items: replacementSource.items.map((item) => ({ ...item })),
  } : { billDate: today(), customerName: "", fatherName: "", address: "", phone: "", deliveryNo: "", deliveryDate: "", items: [blankItem()] });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const totals = useMemo(() => form.items.reduce((sum, item) => ({ value: sum.value + Number(item.assessedValue || 0), loan: sum.loan + Number(item.loanAmount || 0) }), { value: 0, loan: 0 }), [form.items]);
  const set = <K extends keyof BillInput>(key: K, value: BillInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const item = (index: number, key: keyof BillItemInput, value: string) => setForm((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: key === "particulars" ? value : Number(value) } : row) }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const path = replacementSource ? `/api/bills/${replacementSource.id}/replace` : "/api/bills"; const { bill } = await api(path, accountSlot, { method: "POST", body: JSON.stringify(form) }); onCreated(bill); setForm({ billDate: today(), customerName: "", fatherName: "", address: "", phone: "", deliveryNo: "", deliveryDate: "", items: [blankItem()] }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to issue bill."); } finally { setBusy(false); }
  }
  return <section className="panel"><div className="section-heading"><div><p className="eyebrow">{replacementSource ? `ACCOUNT ${accountSlot} · REPLACE BILL #${replacementSource.billNumber}` : `ACCOUNT ${accountSlot} · NEW BILL`}</p><h2>Customer and pledge details</h2>{replacementSource && <p>Saving will void the original and issue a new bill number.</p>}</div><span className="pill">No GST</span></div><form onSubmit={submit}><div className="form-grid"><label>Bill date<input type="date" value={form.billDate} onChange={(e) => set("billDate", e.target.value)} required /></label><label><span className="field-label">Delivery number <span className="muted">(optional)</span></span><input value={form.deliveryNo} onChange={(e) => set("deliveryNo", e.target.value)} /></label><label><span className="field-label">Delivery date <span className="muted">(optional)</span></span><input type="date" value={form.deliveryDate} onChange={(e) => set("deliveryDate", e.target.value)} /></label><label>Customer name<input value={form.customerName} onChange={(e) => set("customerName", e.target.value)} required /></label><label>Father&apos;s name<input value={form.fatherName} onChange={(e) => set("fatherName", e.target.value)} required /></label><label><span className="field-label">Mobile number <span className="muted">(optional)</span></span><input inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label><label className="wide">Address<textarea value={form.address} onChange={(e) => set("address", e.target.value)} required /></label></div><div className="item-table-wrap"><table className="item-table"><thead><tr><th>Particulars</th><th>Gram</th><th>Assessed value</th><th>Loan amount</th><th /></tr></thead><tbody>{form.items.map((row, index) => <tr key={index}><td><input value={row.particulars} onChange={(e) => item(index, "particulars", e.target.value)} required /></td><td><input type="number" step="0.001" min="0" value={row.grams || ""} onChange={(e) => item(index, "grams", e.target.value)} required /></td><td><input type="number" step="0.01" min="0" value={row.assessedValue || ""} onChange={(e) => item(index, "assessedValue", e.target.value)} required /></td><td><input type="number" step="0.01" min="0" value={row.loanAmount || ""} onChange={(e) => item(index, "loanAmount", e.target.value)} required /></td><td>{form.items.length > 1 && <button type="button" className="icon-button danger" aria-label="Remove item" onClick={() => set("items", form.items.filter((_, itemIndex) => itemIndex !== index))}>×</button>}</td></tr>)}</tbody></table><button className="secondary" type="button" onClick={() => set("items", [...form.items, blankItem()])}>+ Add item</button></div><div className="total-bar"><span>Assessed total <strong>{formatINR(totals.value)}</strong></span><span>Loan total <strong>{formatINR(totals.loan)}</strong></span><button disabled={busy}>{busy ? "Saving…" : replacementSource ? "Issue replacement" : "Issue bill"}</button></div>{error && <p className="error">{error}</p>}</form></section>;
}
