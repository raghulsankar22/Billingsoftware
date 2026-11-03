"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { jewelleryLabel, jewelleryNameSchema } from "@/lib/jewellery";
import { api } from "./api";
import { useLanguage } from "./language-provider";

export function JewelleryManager({ accountSlot, items, onChange, onClose }: { accountSlot: AccountSlot; items: string[]; onChange: (items: string[]) => void; onClose: () => void }) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [originalName, setOriginalName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  function reset() { setOriginalName(null); setName(""); setError(""); }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = jewelleryNameSchema.safeParse(name);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api("/api/jewellery", accountSlot, { method: originalName === null ? "POST" : "PATCH", body: JSON.stringify({ name: parsed.data, ...(originalName === null ? {} : { originalName }) }) });
      onChange(result.items); reset(); setSearch(""); setNotice("Jewellery list saved. Existing bills are unchanged.");
      nameField.current?.focus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save jewellery."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (busy || deleting === null) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api("/api/jewellery", accountSlot, { method: "DELETE", body: JSON.stringify({ name: deleting }) });
      onChange(result.items); reset(); setDeleting(null); setNotice("Jewellery name removed from future selections. Existing bills are unchanged.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to delete jewellery."); }
    finally { setBusy(false); }
  }
  const visible = items.filter(item => jewelleryLabel(item).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <dialog ref={dialog} className="jewellery-manager" aria-labelledby="jewellery-manager-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="section-heading"><h2 id="jewellery-manager-title">{t("Manage jewellery")}</h2><button type="button" className="secondary" disabled={busy} onClick={onClose}>{t("Close")}</button></div>
    <p className="muted">{t("This list is shared by your business accounts. Editing or deleting a name changes future selections only, not existing bills, PDFs or Excel records.")}</p>
    {deleting !== null ? <section className="jewellery-delete-confirm" aria-label={t("Confirm jewellery deletion")}>
      <p>{t("Remove from jewellery choices?")} <strong>{jewelleryLabel(deleting)}</strong></p>
      <p>{t("You can add the name again later. Existing bill particulars will not change.")}</p>
      <div className="jewellery-add-actions"><button type="button" className="danger" disabled={busy} onClick={() => void remove()}>{busy ? t("Deleting…") : t("Delete jewellery")}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setDeleting(null); setError(""); }}>{t("Cancel")}</button></div>
    </section> : <>
      <form className="jewellery-manager-editor" onSubmit={event => void save(event)}>
        <label htmlFor="managed-jewellery-name">{t(originalName === null ? "New jewellery name" : "Edit jewellery name")}</label>
        <input ref={nameField} id="managed-jewellery-name" value={name} minLength={2} maxLength={180} required disabled={busy} onChange={event => { setName(event.target.value); setError(""); }} />
        <div className="jewellery-add-actions"><button disabled={busy}>{busy ? t("Saving…") : t(originalName === null ? "Add jewellery" : "Save changes")}</button>{originalName !== null && <button type="button" className="secondary" disabled={busy} onClick={reset}>{t("Cancel edit")}</button>}</div>
      </form>
      <label className="jewellery-manager-search">{t("Find jewellery")}<input autoFocus type="search" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} /></label>
      <ul className="jewellery-manager-list">{visible.map(item => <li key={item}><span>{jewelleryLabel(item)}</span><div><button type="button" className="secondary" disabled={busy} aria-label={t("Edit jewellery") + ": " + jewelleryLabel(item)} onClick={() => { setOriginalName(item); setName(item); setError(""); setNotice(""); nameField.current?.focus(); }}>{t("Edit")}</button><button type="button" className="text-button danger" disabled={busy} aria-label={t("Delete jewellery") + ": " + jewelleryLabel(item)} onClick={() => { setDeleting(item); setError(""); setNotice(""); }}>{t("Delete")}</button></div></li>)}</ul>
      {!visible.length && <p className="muted">{t("No jewellery names match your search.")}</p>}
    </>}
    {error && <p className="error" role="alert">{t(error)}</p>}
    {notice && <p className="notice" role="status">{t(notice)}</p>}
  </dialog>;
}
