"use client";

import { useLanguage } from "./language-provider";

/** Shown on the delivery screen when the customer has lost the bill. Saving waits for the tick. */
export function LostBillConfirm({ printed, signed, disabled, onPrint, onSigned }: { printed: boolean; signed: boolean; disabled: boolean; onPrint: () => void; onSigned: (signed: boolean) => void }) {
  const { t } = useLanguage();
  return <div className="lost-bill-confirm" role="group" aria-label={t("Lost bill declaration")}>
    <p><b>{t("The customer has lost the bill.")}</b> {t("Print the lost bill declaration, get it signed by the customer and a witness, and keep it in the shop.")}</p>
    <button type="button" className="secondary" disabled={disabled} onClick={onPrint}>{t("Print lost bill declaration")}</button>
    <label><input type="checkbox" checked={signed} disabled={disabled || !printed} onChange={event => onSigned(event.target.checked)} />{t("The customer has signed the lost bill declaration")}</label>
    {!printed && <p className="muted">{t("Print the declaration first. Then tick the box to save the delivery.")}</p>}
  </div>;
}
