"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { billingToday } from "@/lib/business-updates";
import type { CashAccountDay, CashBookAction, CashBookView, CashEntry, CashEntryKind, CashTotals, PaymentMethod } from "@/lib/cashbook-types";
import { formatINR } from "@/lib/money";
import { api } from "./api";
import { useLanguage } from "./language-provider";

type ActionDraft = CashBookAction extends infer Action ? Action extends CashBookAction ? Omit<Action, "operationId"> : never : never;
type PostAction = (action: ActionDraft) => Promise<boolean>;
type Translate = (text: string) => string;

const entryKinds: { value: CashEntryKind; label: string }[] = [
  { value: "collection", label: "Collection" },
  { value: "disbursement", label: "Loan disbursement" },
  { value: "expense", label: "Expense" },
  { value: "cash_in", label: "Cash introduced" },
  { value: "cash_out", label: "Cash withdrawn" },
];
const paymentMethods: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank", label: "Bank" },
];

function moneyValue(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(Math.round(amount * 100)) ? amount : null;
}

function inPaise(amount: number) {
  return Math.round(amount * 100);
}

function recordedMoney(amount: number | null, t: Translate) {
  return amount === null ? t("Not recorded") : formatINR(amount);
}

function isOpenDate(day: CashAccountDay, date: string) {
  return !day.closed && day.opening !== null && date >= day.opening.date && (!day.lastClosedDate || date > day.lastClosedDate);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed. Your form has not been cleared.";
}

export function CashBook({ accountSlot }: { accountSlot: number }) {
  return <CashBookWorkspace key={accountSlot} accountSlot={accountSlot} />;
}

function CashBookWorkspace({ accountSlot }: { accountSlot: number }) {
  const [date, setDate] = useState(billingToday);
  const [combined, setCombined] = useState(false);
  const [operations] = useState(() => new Map<string, { payload: string; operationId: string }>());
  return <CashBookDay key={`${date}:${combined}`} accountSlot={accountSlot} date={date} combined={combined}
    onDateChange={setDate} onCombinedChange={setCombined} operations={operations} />;
}

function CashBookDay({ accountSlot, date, combined, onDateChange, onCombinedChange, operations }: {
  accountSlot: number;
  date: string;
  combined: boolean;
  onDateChange: (date: string) => void;
  onCombinedChange: (combined: boolean) => void;
  operations: Map<string, { payload: string; operationId: string }>;
}) {
  const { t } = useLanguage();
  const [view, setView] = useState<CashBookView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [stale, setStale] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reversing, setReversing] = useState<CashEntry | null>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api(`/api/cashbook?date=${encodeURIComponent(date)}${combined ? "&all=1" : ""}`, accountSlot, { cache: "no-store", signal: controller.signal })
      .then((result: CashBookView) => {
        if (!active) return;
        if (result.date !== date) throw new Error("The returned date does not match. Refresh before continuing.");
        setView(result);
        setStale(false);
      })
      .catch((failure: unknown) => { if (active) { setStale(true); setError(errorMessage(failure)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [accountSlot, date, combined, refresh]);

  const day = view?.accounts.find(account => account.accountSlot === accountSlot);
  const disabled = pending || loading || stale;

  async function postAction(action: ActionDraft) {
    if (submitting.current || disabled || combined) return false;
    const payload = JSON.stringify(action);
    const key = `${accountSlot}:${action.action}`;
    const previous = operations.get(key);
    const operation = previous?.payload === payload ? previous : { payload, operationId: crypto.randomUUID() };
    operations.set(key, operation);
    submitting.current = true;
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const result: CashBookView = await api("/api/cashbook", accountSlot, {
        method: "POST", cache: "no-store", body: JSON.stringify({ ...action, operationId: operation.operationId }),
      });
      if (!mounted.current) return false;
      if (result.date !== action.date || !result.accounts.some(account => account.accountSlot === accountSlot)) {
        setStale(true);
        setError("The record may have been saved. Refresh to check the journal before continuing.");
        return false;
      }
      operations.delete(key);
      if (result.date !== date) {
        onDateChange(result.date);
      } else {
        setView(result);
        setReversing(null);
        setSuccess(action.action === "close" ? "Day closed. This date and earlier dates are locked." : "Confirmed record saved.");
      }
      return true;
    } catch (failure) {
      if (mounted.current) {
        setError(errorMessage(failure));
        if (failure && typeof failure === "object" && "status" in failure && failure.status === 409) setStale(true);
      }
      return false;
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return <section className="panel cashbook" aria-labelledby="cashbook-title" aria-busy={loading || pending}>
    <div className="cashbook-heading">
      <div><h2 id="cashbook-title">{t("Payments / Daily Closing")}</h2><p className="cashbook-help">{t("Only explicitly confirmed money movements appear here. Old bills are not payments.")}</p></div>
      <div className="cashbook-controls">
        <label>{t("Date")}<input type="date" max={billingToday()} value={date} required disabled={pending} onChange={event => { if (event.target.value) onDateChange(event.target.value); }} /></label>
        <label className="cashbook-check"><input type="checkbox" checked={combined} disabled={pending} onChange={event => onCombinedChange(event.target.checked)} />{t("Combined accounts (read only)")}</label>
        <button type="button" className="secondary" disabled={pending || loading} onClick={() => { if (!submitting.current) { setLoading(true); setSuccess(""); setRefresh(value => value + 1); } }}>{t("Refresh")}</button>
      </div>
    </div>
    {error ? <p className="cashbook-error" role="alert">{t(error)}</p> : null}
    {stale ? <p className="cashbook-warning">{t("Refresh before posting or closing. Your form values are preserved; check the journal before retrying.")}</p> : null}
    {success ? <p className="cashbook-success" role="status">{t(success)}</p> : null}
    {loading ? <p role="status">{t("Loading payments and closing balances...")}</p> : null}
    {pending ? <p role="status">{t("Saving confirmation... Do not submit again.")}</p> : null}
    {view && combined ? <>
      <p className="cashbook-warning">{t("Read only. These are the signed-in user's business accounts. No payments, reversals or closings can be posted in combined mode.")}</p>
      <BalanceSummary title={t("Combined balances")} balances={view.combined} />
      {view.accounts.length === 0 ? <p>{t("No business accounts to display.")}</p> : view.accounts.map(account => <section className="cashbook-account" key={account.accountSlot}>
        <h3>{t("Account")} {account.accountSlot}{account.businessName ? ` / ${account.businessName}` : ""}</h3>
        <AccountStatus day={account} date={date} />
        <BalanceSummary title={t("Account balances")} balances={account} />
        <Journal day={account} />
      </section>)}
    </> : day ? <>
      <h3>{t("Account")} {day.accountSlot}{day.businessName ? ` / ${day.businessName}` : ""}</h3>
      <AccountStatus day={day} date={date} />
      <BalanceSummary title={t("Daily balances")} balances={day} />
      {day.opening === null ? <OpeningForm date={date} disabled={disabled} postAction={postAction} /> : null}
      {isOpenDate(day, date) ? <div className="cashbook-workspace">
        <EntryForm day={day} date={date} disabled={disabled} postAction={postAction} />
        <ClosingForm day={day} date={date} disabled={disabled} postAction={postAction} />
      </div> : day.opening ? <p className="cashbook-warning">{t("This date is locked or precedes the opening date. Record corrections as reversals on an open date; closed dates are never rewritten.")}</p> : null}
      <Journal day={day} onReverse={entry => { setReversing(entry); setSuccess(""); }} disabled={disabled} />
      {reversing ? <ReversalForm key={reversing.id} accountSlot={accountSlot} entry={reversing} disabled={disabled}
        postAction={postAction} onCancel={() => setReversing(null)} /> : null}
    </> : !loading && !combined ? <p>{t("This business account is not available. Refresh or select another account.")}</p> : null}
  </section>;
}

function AccountStatus({ day, date }: { day: CashAccountDay; date: string }) {
  const { t } = useLanguage();
  const status = day.closed || (day.lastClosedDate && date <= day.lastClosedDate)
    ? "Closed / locked" : !day.opening ? "Opening not recorded" : date < day.opening.date ? "Before opening date" : "Open";
  return <div className="cashbook-account-status">
    <strong>{t(status)}</strong>
    <span>{t("Opening setup")}: {day.opening ? `${day.opening.date} / ${formatINR(day.opening.amount)}` : t("Not recorded")}</span>
    {day.lastClosedDate ? <span>{t("Last closed date")}: {day.lastClosedDate}</span> : null}
    {day.closingNote ? <span className="cashbook-note">{t("Closing explanation")}: {day.closingNote}</span> : null}
  </div>;
}

function BalanceSummary({ title, balances }: { title: string; balances: {
  openingCash: number | null; expectedCash: number | null; countedCash: number | null; difference: number | null; totals: CashTotals;
} }) {
  const { t } = useLanguage();
  const totalRows: [string, number][] = [
    ["Principal received", balances.totals.principalReceived], ["Actual interest received", balances.totals.interestReceived],
    ["Interest discounts", balances.totals.discount], ["Loans paid", balances.totals.loansPaid], ["Expenses", balances.totals.expenses],
  ];
  return <section className="cashbook-summary" aria-label={title}>
    <h3>{title}</h3>
    <dl className="cashbook-balances">
      <div><dt>{t("Opening cash")}</dt><dd>{recordedMoney(balances.openingCash, t)}</dd></div>
      <div><dt>{t("Expected cash")}</dt><dd>{recordedMoney(balances.expectedCash, t)}</dd></div>
      <div><dt>{t("Counted cash")}</dt><dd>{recordedMoney(balances.countedCash, t)}</dd></div>
      <div><dt>{t("Difference")}</dt><dd>{recordedMoney(balances.difference, t)}</dd></div>
    </dl>
    <div className="cashbook-table-wrap" tabIndex={0} role="region" aria-label={t("Payment method totals")}>
      <table className="cashbook-table"><caption>{t("Confirmed movements by payment method")}</caption>
        <thead><tr><th scope="col">{t("Method")}</th><th scope="col">{t("Received")}</th><th scope="col">{t("Paid")}</th><th scope="col">{t("Net movement")}</th></tr></thead>
        <tbody>{paymentMethods.map(method => {
          const received = balances.totals[`${method.value}In`];
          const paid = balances.totals[`${method.value}Out`];
          return <tr key={method.value}><th scope="row">{t(method.label)}</th><td>{formatINR(received)}</td><td>{formatINR(paid)}</td><td>{formatINR((inPaise(received) - inPaise(paid)) / 100)}</td></tr>;
        })}</tbody>
      </table>
    </div>
    <dl className="cashbook-totals">{totalRows.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{formatINR(value)}</dd></div>)}</dl>
    <p className="cashbook-help">{t("Expected physical cash uses Cash only. UPI and Bank are separate. Earlier open-day entries are already included in opening cash.")}</p>
  </section>;
}

function EntryForm({ day, date, disabled, postAction }: { day: CashAccountDay; date: string; disabled: boolean; postAction: PostAction }) {
  const { t } = useLanguage();
  const [kind, setKind] = useState<CashEntryKind>("collection");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [billId, setBillId] = useState("");
  const [amount, setAmount] = useState("");
  const [interest, setInterest] = useState("");
  const [discount, setDiscount] = useState("0");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const bill = day.bills.find(candidate => candidate.id === billId);
  const usesBill = kind === "collection" || kind === "disbursement";
  const cashOnly = kind === "cash_in" || kind === "cash_out";
  const actualInterest = moneyValue(interest);
  const actualDiscount = moneyValue(discount);
  const received = bill && actualInterest !== null ? (inPaise(bill.principal) + inPaise(actualInterest)) / 100 : null;
  const needsHistoricalNote = kind === "collection" && bill?.expectedInterest === null;

  function changeKind(value: CashEntryKind) {
    setKind(value);
    setBillId("");
    setAmount("");
    setInterest("");
    setDiscount("0");
    setError("");
    if (value === "cash_in" || value === "cash_out") setMethod("cash");
  }

  function selectBill(value: string) {
    const selected = day.bills.find(candidate => candidate.id === value);
    setBillId(value);
    setAmount(selected && kind === "disbursement" ? String(selected.principal) : "");
    setInterest(selected?.expectedInterest !== null && selected?.expectedInterest !== undefined ? String(selected.expectedInterest) : "");
    setDiscount("0");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    let action: ActionDraft;
    if (usesBill && (!bill || !(kind === "collection" ? bill.canCollect : bill.canDisburse))) {
      setError("Choose an eligible bill that is Not recorded."); return;
    }
    if (kind === "collection" && bill) {
      if (actualInterest === null || actualDiscount === null || received === null || !Number.isSafeInteger(inPaise(received)) || received <= 0) {
        setError("Enter actual interest and discount explicitly, with at most two decimal places."); return;
      }
      if (bill.expectedInterest !== null && inPaise(actualInterest) + inPaise(actualDiscount) !== inPaise(bill.expectedInterest)) {
        setError("Actual interest plus discount must equal expected interest. Partial payments are not supported."); return;
      }
      if (needsHistoricalNote && !note.trim()) { setError("Add an explanatory note for historical interest without a saved calculation."); return; }
      action = { action: "entry", date, kind, method, amount: received, principal: bill.principal, interest: actualInterest, discount: actualDiscount, billId: bill.id, note };
    } else {
      const paid = moneyValue(amount);
      if (paid === null || paid <= 0) { setError("Enter an amount greater than zero, with at most two decimal places."); return; }
      if (kind === "disbursement" && bill && inPaise(paid) > inPaise(bill.principal)) {
        setError("Actual amount paid cannot exceed the bill principal."); return;
      }
      action = { action: "entry", date, kind, method: cashOnly ? "cash" : method, amount: paid, note,
        ...(kind === "disbursement" && bill ? { billId: bill.id } : {}) };
    }
    if (await postAction(action)) { setBillId(""); setAmount(""); setInterest(""); setDiscount("0"); setNote(""); }
  }

  return <form className="cashbook-form" onSubmit={submit}>
    <h3>{t("Confirm a money movement")}</h3>
    <fieldset disabled={disabled}><legend className="cashbook-sr-only">{t("Payment entry")}</legend>
      <label>{t("Entry type")}<select value={kind} onChange={event => changeKind(event.target.value as CashEntryKind)}>{entryKinds.map(item => <option key={item.value} value={item.value}>{t(item.label)}</option>)}</select></label>
      <div className="cashbook-field-pair">
        <label>{t("Entry date")}<input type="date" readOnly value={date} /><span className="cashbook-help">{t("Change the date at the top of this screen.")}</span></label>
        <label>{t("Payment method")}<select value={cashOnly ? "cash" : method} disabled={cashOnly} onChange={event => setMethod(event.target.value as PaymentMethod)}>{paymentMethods.map(item => <option key={item.value} value={item.value}>{t(item.label)}</option>)}</select></label>
      </div>
      {usesBill ? <label>{t("Bill / customer")}<select value={billId} required onChange={event => selectBill(event.target.value)}>
        <option value="">{t("Choose a bill")}</option>
        {day.bills.map(option => {
          const recorded = kind === "collection" ? option.collectionRecorded : option.disbursementRecorded;
          const eligible = kind === "collection" ? option.canCollect : option.canDisburse;
          return <option key={option.id} value={option.id} disabled={!eligible}>{t("Bill")} {option.billNumber} / {option.customerName} / {t(recorded ? "Confirmed" : "Not recorded")}</option>;
        })}
      </select></label> : null}
      {bill && usesBill ? <div className="cashbook-bill-details">
        <strong>{bill.customerName}</strong><span>{t("Bill")} {bill.billNumber} / {bill.billDate}</span>
        <span>{t(kind === "collection" ? (bill.collectionRecorded ? "Confirmed" : "Not recorded") : (bill.disbursementRecorded ? "Confirmed" : "Not recorded"))}</span>
        <span>{t("Full principal")}: {formatINR(bill.principal)}</span>
        {bill.deliveryNo ? <span>{t("Delivery")}: {bill.deliveryNo}</span> : null}
      </div> : null}
      {kind === "collection" ? <>
        <p className="cashbook-help">{t("Collect the full bill principal. Actual interest plus discount must equal saved expected interest. Discounts waive interest; they are not cash received.")}</p>
        <p>{t("Expected interest")}: <strong>{recordedMoney(bill?.expectedInterest ?? null, t)}</strong></p>
        {needsHistoricalNote ? <p className="cashbook-warning">{t("Historical interest was not recorded. Enter actual interest explicitly and add an explanatory note; no interest is assumed.")}</p> : null}
        <div className="cashbook-field-pair">
          <label>{t("Actual interest received")}<input type="number" inputMode="decimal" min="0" step="0.01" required value={interest} onChange={event => setInterest(event.target.value)} /></label>
          <label>{t("Interest discount")}<input type="number" inputMode="decimal" min="0" step="0.01" required value={discount} onChange={event => setDiscount(event.target.value)} /></label>
        </div>
        <p className="cashbook-receipt" aria-live="polite">{t("Amount received = principal + actual interest")}: <strong>{recordedMoney(received, t)}</strong></p>
      </> : <label>{t(kind === "disbursement" ? "Actual amount paid" : "Amount")}<input type="number" inputMode="decimal" min="0.01" max={kind === "disbursement" ? bill?.principal : undefined} step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /></label>}
      {kind === "disbursement" ? <p className="cashbook-help">{t("Confirm what was actually handed to the customer. It can be lower than the bill principal.")}</p> : null}
      <label>{t("Note")}<textarea value={note} required={needsHistoricalNote} onChange={event => setNote(event.target.value)} rows={3} /></label>
      {error ? <p className="cashbook-error" role="alert">{t(error)}</p> : null}
      <button type="submit" disabled={usesBill && !bill}>{t("Confirm payment record")}</button>
      <p className="cashbook-help">{t("Suggested amounts are not payments. Nothing is posted until you confirm.")}</p>
    </fieldset>
  </form>;
}

function ClosingForm({ day, date, disabled, postAction }: { day: CashAccountDay; date: string; disabled: boolean; postAction: PostAction }) {
  const { t } = useLanguage();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [acknowledgedRevision, setAcknowledgedRevision] = useState<string | null>(null);
  const [error, setError] = useState("");
  const amount = moneyValue(counted);
  const difference = amount !== null && day.expectedCash !== null ? (inPaise(amount) - inPaise(day.expectedCash)) / 100 : null;
  const needsExplanation = difference !== null && difference !== 0;
  const hasUnrecorded = day.unrecorded.collections > 0 || day.unrecorded.disbursements > 0;
  const acknowledged = acknowledgedRevision === day.revision;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (amount === null || day.expectedCash === null) { setError("Enter counted cash. Opening and expected cash must be recorded before closing."); return; }
    if (needsExplanation && !note.trim()) { setError("Explain the difference between counted and expected cash."); return; }
    if (hasUnrecorded && !acknowledged) { setError("Acknowledge the unrecorded bills before closing."); return; }
    setError("");
    void postAction({ action: "close", date, countedCash: amount, revision: day.revision, note, acknowledgeUnrecorded: acknowledged });
  }

  return <form className="cashbook-form cashbook-closing" onSubmit={submit}>
    <h3>{t("Daily Closing")}</h3>
    <p className="cashbook-help">{t("Count physical cash, not UPI or Bank. Closing locks this date and earlier dates. It cannot be edited or reopened.")}</p>
    <fieldset disabled={disabled || day.expectedCash === null}><legend className="cashbook-sr-only">{t("Close the selected day")}</legend>
      <p>{t("Expected cash")}: <strong>{recordedMoney(day.expectedCash, t)}</strong></p>
      <label>{t("Counted cash")}<input type="number" inputMode="decimal" min="0" step="0.01" required value={counted} onChange={event => setCounted(event.target.value)} /></label>
      <p className="cashbook-receipt" aria-live="polite">{t("Difference")}: <strong>{recordedMoney(difference, t)}</strong></p>
      <label>{t("Closing explanation")}<textarea rows={3} required={needsExplanation} value={note} onChange={event => setNote(event.target.value)} /><span className="cashbook-help">{t("Required when counted cash differs from expected cash. A difference is not booked as income or expense.")}</span></label>
      <div className={hasUnrecorded ? "cashbook-warning" : "cashbook-help"}>
        <p>{t("Bills still Not recorded on this date")}: {t("Collections")} {day.unrecorded.collections}; {t("Disbursements")} {day.unrecorded.disbursements}</p>
        {hasUnrecorded ? <label className="cashbook-check"><input type="checkbox" required checked={acknowledged} onChange={event => setAcknowledgedRevision(event.target.checked ? day.revision : null)} />{t("I checked these unrecorded bills and acknowledge closing without confirming them as payments.")}</label> : null}
      </div>
      {error ? <p className="cashbook-error" role="alert">{t(error)}</p> : null}
      <button type="submit">{t("Confirm and close day")}</button>
    </fieldset>
  </form>;
}

function Journal({ day, onReverse, disabled = false }: { day: CashAccountDay; onReverse?: (entry: CashEntry) => void; disabled?: boolean }) {
  const { t } = useLanguage();
  const bills = new Map(day.bills.map(bill => [bill.id, bill]));
  return <section className="cashbook-journal" aria-label={t("Read-only journal")}>
    <h3>{t("Confirmed journal")}</h3>
    <p className="cashbook-help">{t("Posted entries are read only. Corrections require an explicit reversal on an open date, then a new correct record if needed.")}</p>
    {day.entries.length === 0 ? <p>{t("No confirmed money movements for this date. Existing bills have not been inferred as payments.")}</p> : <div className="cashbook-table-wrap" tabIndex={0} role="region" aria-label={t("Journal entries")}>
      <table className="cashbook-table cashbook-journal-table"><caption>{t("Confirmed money movements")}</caption>
        <thead><tr>{["Date", "Entry", "Bill / customer", "Method", "Amount", "Principal", "Actual interest", "Discount", "Note / recorded by", "Status"].map(label => <th scope="col" key={label}>{t(label)}</th>)}{onReverse ? <th scope="col">{t("Correction")}</th> : null}</tr></thead>
        <tbody>{day.entries.map(entry => <tr key={entry.id}>
          <td><time dateTime={entry.date}>{entry.date}</time></td>
          <td>{t(entryKinds.find(item => item.value === entry.kind)?.label ?? entry.kind)}{entry.reversesId ? <small>{t("Reversal")}</small> : null}</td>
          <td>{entry.billNumber !== null ? <>{t("Bill")} {entry.billNumber}<small>{entry.billId ? bills.get(entry.billId)?.customerName : null}</small>{entry.deliveryNo ? <small>{t("Delivery")}: {entry.deliveryNo}</small> : null}</> : t("Not linked to a bill")}</td>
          <td>{t(paymentMethods.find(method => method.value === entry.method)?.label ?? entry.method)}</td>
          <td>{formatINR(entry.amount)}</td><td>{formatINR(entry.principal)}</td><td>{formatINR(entry.interest)}</td><td>{formatINR(entry.discount)}</td>
          <td className="cashbook-note">{entry.note}<small>{entry.actor}</small><small><time dateTime={entry.createdAt}>{entry.createdAt}</time></small></td>
          <td>{t(entry.reversed ? "Reversed" : entry.reversesId ? "Reversal confirmed" : "Confirmed")}</td>
          {onReverse ? <td>{!entry.reversed && !entry.reversesId && day.opening ? <button type="button" className="secondary" disabled={disabled} onClick={() => onReverse(entry)}>{t("Reverse on open date")}</button> : null}</td> : null}
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}

function ReversalForm({ accountSlot, entry, disabled, postAction, onCancel }: {
  accountSlot: number; entry: CashEntry; disabled: boolean; postAction: PostAction; onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [date, setDate] = useState(billingToday);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [target, setTarget] = useState<{ date: string; day: CashAccountDay } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const open = target?.date === date && isOpenDate(target.day, date);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { heading.current?.focus(); }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api(`/api/cashbook?date=${encodeURIComponent(date)}`, accountSlot, { cache: "no-store", signal: controller.signal })
      .then((result: CashBookView) => {
        if (!active) return;
        const day = result.accounts.find(account => account.accountSlot === accountSlot);
        if (result.date !== date || !day) throw new Error("The reversal account or date is not available.");
        setTarget({ date, day });
      })
      .catch((failure: unknown) => { if (active) { setTarget(null); setError(errorMessage(failure)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [accountSlot, date, refresh]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || loading || !open) return;
    if (!note.trim() || !confirmed) { setError("Enter a reversal reason and explicitly confirm the correction."); return; }
    setError("");
    void postAction({ action: "reverse", date, entryId: entry.id, note });
  }

  return <form className="cashbook-form cashbook-reversal" onSubmit={submit} aria-label={t("Confirm reversal")}>
    <h3 ref={heading} tabIndex={-1}>{t("Reverse a confirmed record")}</h3>
    <p>{t(entryKinds.find(item => item.value === entry.kind)?.label ?? entry.kind)} / {formatINR(entry.amount)} / {entry.date}{entry.billNumber !== null ? ` / ${t("Bill")} ${entry.billNumber}` : ""}</p>
    <p>{t("Payment method")}: {t(paymentMethods.find(method => method.value === entry.method)?.label ?? entry.method)}</p>
    {entry.note ? <p className="cashbook-note">{t("Original note")}: {entry.note}</p> : null}
    <p className="cashbook-help">{t("The original record remains in the journal. The reversal is a new money movement on the open date below, which defaults to today.")}</p>
    <fieldset disabled={disabled}><legend className="cashbook-sr-only">{t("Reversal details")}</legend>
      <label>{t("Open date for reversal")}<input type="date" max={billingToday()} required value={date} onChange={event => { if (event.target.value) { setDate(event.target.value); setConfirmed(false); } }} /></label>
      {loading ? <p role="status">{t("Checking reversal date...")}</p> : !open ? <p className="cashbook-warning">{t("Choose an open date with recorded opening cash. A closed date cannot be changed.")}</p> : <p>{t("Open date confirmed")}: {date}</p>}
      <label>{t("Reversal reason")}<textarea rows={3} required value={note} onChange={event => { setNote(event.target.value); setConfirmed(false); }} /></label>
      <label className="cashbook-check"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t("I confirm this reversal on the selected open date. The original record will not be edited.")}</label>
      {error ? <p className="cashbook-error" role="alert">{t(error)}</p> : null}
      <div className="cashbook-actions">
        <button type="submit" disabled={loading || !open || !confirmed}>{t("Confirm reversal")}</button>
        <button type="button" className="secondary" disabled={loading} onClick={() => { setLoading(true); setConfirmed(false); setRefresh(value => value + 1); }}>{t("Recheck open date")}</button>
        <button type="button" className="secondary" onClick={onCancel}>{t("Cancel reversal")}</button>
      </div>
    </fieldset>
  </form>;
}

function OpeningForm({ date, disabled, postAction }: { date: string; disabled: boolean; postAction: PostAction }) {
  const { t } = useLanguage();
  const [openingDate, setOpeningDate] = useState(date);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = moneyValue(amount);
    if (parsed === null) { setError("Enter a non-negative opening cash amount with at most two decimal places."); return; }
    setError("");
    void postAction({ action: "opening", date: openingDate, amount: parsed });
  }
  return <form className="cashbook-form cashbook-opening" onSubmit={submit}>
    <h3>{t("Set opening cash")}</h3>
    <p className="cashbook-help">{t("Enter the physical cash present at the start of this date. This does not reconstruct payments from old bills.")}</p>
    <fieldset disabled={disabled}><legend className="cashbook-sr-only">{t("Opening cash setup")}</legend>
      <label>{t("Opening date")}<input type="date" max={billingToday()} required value={openingDate} onChange={event => setOpeningDate(event.target.value)} /></label>
      <label>{t("Opening cash")}<input type="number" inputMode="decimal" min="0" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /></label>
      {error ? <p className="cashbook-error" role="alert">{t(error)}</p> : null}
      <button type="submit">{t("Confirm opening cash")}</button>
    </fieldset>
  </form>;
}
