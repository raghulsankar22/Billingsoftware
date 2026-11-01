"use client";

import { useEffect, useRef } from "react";
import type { Bill } from "@/lib/types";

export function DeliveredBillNotice({ bills, onClose }: { bills: Bill[]; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <div className="modal-backdrop delivered-notice-backdrop"><section className="delivered-bill-notice" role="alertdialog" aria-modal="true" aria-labelledby="delivered-notice-title" aria-describedby="delivered-notice-details" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key === "Tab") { event.preventDefault(); closeButton.current?.focus(); }
  }}>
    <h2 id="delivered-notice-title">{bills.length === 1 ? "This bill has been delivered" : "These bills have been delivered"}</h2>
    <div id="delivered-notice-details">{bills.map(bill => <p key={bill.id}><b>Bill #{bill.billNumber} · {bill.customerName}</b><br />Delivery {bill.deliveryNo ? `#${bill.deliveryNo}` : "number not recorded"} · {bill.deliveryDate || "date not recorded"}</p>)}</div>
    <button type="button" ref={closeButton} onClick={onClose}>OK</button>
  </section></div>;
}
