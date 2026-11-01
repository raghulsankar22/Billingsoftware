"use client";

import { useLanguage } from "./language-provider";

import { useState } from "react";
import type { HistoricalImportRow } from "@/lib/historical-import";
import { withAccountSlot } from "@/lib/account-url";
import { formatINR } from "@/lib/money";

type Result = { rows: HistoricalImportRow[]; warnings: string[]; notes?: string[] };

function sessionChecked(response: Response) {
  if (response.status === 401) window.dispatchEvent(new Event("billing-session-expired"));
  return response;
}

export function ImportPreview({ accountSlot, onImported }: { accountSlot: number; onImported: () => void }) {
  const { t } = useLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [fileKey, setFileKey] = useState(0);
  const [metals, setMetals] = useState<Record<string, "Gold" | "Silver">>({});
  const rowKey = (row: HistoricalImportRow) => `${row.sheet}:${row.row}`;
  async function inspect() {
    if (!file) return;
    setLoading(true); setError(""); setMessage(""); setResult(null); setMetals({});
    try {
      const form = new FormData(); form.append("file", file);
      const response = sessionChecked(await fetch(withAccountSlot("/api/import-preview", accountSlot), { method: "POST", body: form }));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to read the file.");
      setResult(payload);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to read the file."); }
    finally { setLoading(false); }
  }
  async function importBills() {
    if (!file || !result || loading) return;
    setLoading(true); setError(""); setMessage("");
    try {
      const form = new FormData(); form.append("file", file); form.append("metals", JSON.stringify(metals));
      const response = sessionChecked(await fetch(withAccountSlot("/api/import-historical", accountSlot), { method: "POST", body: form }));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to import these bills.");
      setMessage(`${payload.count} bills imported to Account ${accountSlot}. ${payload.warning || "Excel register refreshed."}`);
      setResult(null); setMetals({}); setFile(null); setFileKey(value => value + 1);
      onImported();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to import these bills."); }
    finally { setLoading(false); }
  }
  const hasBlockingIssues = result?.rows.some(row => row.issues.length > 0) ?? false;
  const missingMetal = result?.rows.some(row => !metals[rowKey(row)]) ?? true;
  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">{t("ACCOUNT")} {accountSlot}</p><h2>{t("Import old bills")}</h2></div></div>
    <p>{t("Preview an Excel workbook before importing. This preview does not save or change any bills. Text dates are read as day/month/year.")}</p>
    <label>{t("Excel file (.xlsx)")} <input key={fileKey} type="file" accept=".xlsx" disabled={loading} onChange={event => { setFile(event.target.files?.[0] ?? null); setResult(null); setError(""); setMessage(""); }} /></label>{" "}
    <button type="button" disabled={!file || loading} onClick={() => void inspect()}>{loading ? t("Reading…") : t("Preview bills")}</button>
    {error && <p className="error" role="alert">{t(error)}</p>}
    {message && <p className="excel-notice" role="status">{t(message)}</p>}
    {result && <><p role="status">{result.rows.length} {t("rows found. Review every row and select its metal before importing.")}</p>
      {result.warnings.map(warning => <p className="error" key={warning}>{t(warning)}</p>)}
      {result.notes?.map(note => <p className="overview-warning" key={note}>{t(note)}</p>)}
      <p>{t("Choose Gold or Silver for each bill. Missing father's name, weight and assessed value will be saved as not recorded.")}</p>
      <button type="button" className="secondary" disabled={loading} onClick={() => setMetals(Object.fromEntries(result.rows.map(row => [rowKey(row), "Gold"])))}>{t("Set all to Gold")}</button>{" "}
      <button type="button" className="secondary" disabled={loading} onClick={() => setMetals(Object.fromEntries(result.rows.map(row => [rowKey(row), "Silver"])))}>{t("Set all to Silver")}</button>
      <div className="item-table-wrap"><table className="history-table"><thead><tr><th>{t("Sheet / row")}</th><th>{t("Bill")}</th><th>{t("Date")}</th><th>{t("Customer")}</th><th>{t("Address")}</th><th>{t("Particulars")}</th><th>{t("Metal")}</th><th>{t("Phone")}</th><th>{t("Excel amount")}</th><th>{t("Delivery no.")}</th><th>{t("Delivery date")}</th><th>{t("Status")}</th><th>{t("Review")}</th></tr></thead>
        <tbody>{result.rows.map(row => <tr key={rowKey(row)}><td>{row.sheet} / {row.row}</td><td>{row.billNo}</td><td>{row.billDate ?? "—"}</td><td>{row.name}</td><td>{row.address}</td><td>{row.particulars}</td><td><select aria-label={`${t("Metal")} · ${row.sheet} · ${t("Row")} ${row.row}`} value={metals[rowKey(row)] ?? ""} onChange={event => { const value = event.target.value; setMetals(previous => { const next = { ...previous }; if (value === "Gold" || value === "Silver") next[rowKey(row)] = value; else delete next[rowKey(row)]; return next; }); }}><option value="">{t("Choose metal")}</option><option value="Gold">{t("Gold")}</option><option value="Silver">{t("Silver")}</option></select></td><td>{row.phone || "—"}</td><td>{row.amount === null ? "—" : formatINR(row.amount)}</td><td>{row.deliveryNo || "—"}</td><td>{row.deliveryDate ?? "—"}</td><td>{row.issues.includes("Check delivery date") ? t("Review delivery date") : `${row.voided ? t("Voided · ") : ""}${t(row.deliveryNo || row.deliveryDate ? "Delivered" : "Pending")}`}</td><td>{[...row.issues, ...row.notices].map(t).join("; ") || "—"}</td></tr>)}</tbody>
      </table></div>
      {hasBlockingIssues && <p className="error">{t("Resolve the flagged errors and duplicate bill numbers in the Excel file, then preview it again.")}</p>}
      {missingMetal && <p className="overview-warning">{t("Choose a metal for every bill.")}</p>}
      <p>{t("A database backup will be created before importing. No existing bills will be overwritten.")}</p>
      <button type="button" disabled={loading || !result.rows.length || !!result.warnings.length || hasBlockingIssues || missingMetal} onClick={() => void importBills()}>{loading ? t("Importing…") : t(`Import ${result.rows.length} bills into Account ${accountSlot}`)}</button></>}
  </section>;
}
