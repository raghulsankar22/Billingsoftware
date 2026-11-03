"use client";

import { useEffect, useRef } from "react";
import { changeReasons, type ChangeReason } from "@/lib/bill-history-types";
import { useLanguage } from "./language-provider";

export function BillChangeReasonDialog({ onDone }: { onDone: (reason: ChangeReason | null) => void }) {
  const { t } = useLanguage();
  const panel = useRef<HTMLElement>(null);
  const complete = useRef(onDone);
  useEffect(() => { complete.current = onDone; }, [onDone]);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector("select")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); complete.current(null); }
      if (event.key !== "Tab") return;
      const fields = [...panel.current?.querySelectorAll<HTMLElement>("select, button") ?? []];
      const first = fields[0], last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <div className="modal-backdrop"><section ref={panel} className="overview-modal" role="dialog" aria-modal="true" aria-labelledby="change-reason-title"><h2 id="change-reason-title">{t("Reason for correction")}</h2><p>{t("Choose a reason to keep in the read-only bill history. No customer details are copied into this reason.")}</p><form onSubmit={event => { event.preventDefault(); const reason = new FormData(event.currentTarget).get("reason"); if (typeof reason === "string" && Object.hasOwn(changeReasons, reason)) onDone(reason as ChangeReason); }}><label>{t("Choose a reason")}<select name="reason" required defaultValue=""><option value="">{t("Choose a reason")}</option>{Object.entries(changeReasons).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label><div className="form-actions"><button type="submit">{t("Continue")}</button><button type="button" className="secondary" onClick={() => onDone(null)}>{t("Cancel")}</button></div></form></section></div>;
}
