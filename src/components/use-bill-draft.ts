"use client";

import { newUuid } from "@/lib/uuid";
import { useCallback, useEffect, useRef, useState } from "react";
import { hasBillDraftContent, makeBillDraft, parseBillDraft, type BillDraft, type BillSubmission, type JewelleryDrafts } from "@/lib/bill-drafts";
import type { BillInput } from "@/lib/types";

export function useBillDraft(key: string | null, form: BillInput, jewellery: JewelleryDrafts) {
  const [pending, setPending] = useState<BillDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [warning, setWarning] = useState("");
  const [saved, setSaved] = useState(false);
  const [submission, setSubmission] = useState<BillSubmission | null>(null);
  const submissionRef = useRef<BillSubmission | null>(null);
  const latest = useRef({ form, jewellery });
  const identifier = useRef("");
  const active = useRef(false);
  const cleared = useRef("");
  const conflict = useRef(false);
  const expected = useRef<string | null>(null);
  useEffect(() => { latest.current = { form, jewellery }; }, [form, jewellery]);
  const persist = useCallback(() => {
    if (!key || !active.current || conflict.current) return false;
    const current = latest.current;
    if (!submissionRef.current && JSON.stringify(current) === cleared.current) return false;
    try {
      const existing = window.localStorage.getItem(key);
      if (existing !== expected.current) {
        conflict.current = true; setSaved(false); setWarning("Another window has saved a draft for this account. This window will not overwrite it. Reopen New bill and resume the saved draft before issuing it."); return false;
      }
      if (!submissionRef.current && !hasBillDraftContent(current.form, current.jewellery)) { window.localStorage.removeItem(key); expected.current = null; setSaved(false); return false; }
      const serialized = JSON.stringify(makeBillDraft(identifier.current, current.form, current.jewellery, submissionRef.current ?? undefined));
      window.localStorage.setItem(key, serialized);
      expected.current = serialized;
      setSaved(true); setWarning("");
      return true;
    } catch { setSaved(false); setWarning("Draft recovery is unavailable. Keep this window open until you save the bill."); return false; }
  }, [key]);
  useEffect(() => {
    if (!key) return;
    try { expected.current = window.localStorage.getItem(key); const draft = parseBillDraft(expected.current); identifier.current = draft?.id ?? newUuid(); submissionRef.current = draft?.submission ?? null; setSubmission(submissionRef.current); setPending(draft); active.current = !draft; }
    catch { setWarning("Draft recovery is unavailable. Keep this window open until you save the bill."); active.current = false; }
    setReady(true);
    const flush = () => persist();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => { persist(); active.current = false; window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", flush); };
  }, [key, persist]);
  useEffect(() => { if (!ready || pending) return; const timer = window.setTimeout(persist, 250); return () => window.clearTimeout(timer); }, [form, jewellery, ready, pending, persist]);
  const clear = () => {
    cleared.current = JSON.stringify(latest.current);
    if (key) { try { if (window.localStorage.getItem(key) === expected.current) { window.localStorage.removeItem(key); expected.current = null; } } catch { setWarning("The saved draft could not be removed from this browser."); } }
    submissionRef.current = null; setSubmission(null); identifier.current = newUuid();
    setPending(null); setSaved(false); active.current = true;
  };
  const prepareSubmission = (body: string): BillSubmission => {
    if (submissionRef.current) return submissionRef.current;
    const request = { id: identifier.current || newUuid(), body };
    submissionRef.current = request;
    if (!persist()) { submissionRef.current = null; throw new Error("The safe-save request could not be stored on this computer. No bill was sent. Reopen New bill and resume the saved draft, or check browser storage."); }
    setSubmission(request);
    return request;
  };
  const rejectSubmission = () => {
    submissionRef.current = null; setSubmission(null); identifier.current = newUuid(); persist();
  };
  const resume = () => { const draft = pending; setPending(null); active.current = true; return draft; };
  return { pending, ready: !key || ready, warning, saved, submission, prepareSubmission, rejectSubmission, clear, resume };
}
