import React from "react";
import { createRoot } from "react-dom/client";
import { BillForm } from "../src/components/bill-form";
import { BillChangeReasonDialog } from "../src/components/bill-change-reason-dialog";
import { LanguageProvider } from "../src/components/language-provider";
import type { AccountSlot } from "../src/lib/account-url";

const root = createRoot(document.getElementById("root")!);
let generation = 0;
const harness = { fail: false, loseResponse: false, requests: [] as { id: string; body: string }[], saves: 0, reason: "", mount(user = "test-owner", account: AccountSlot = 1) {
  root.render(<LanguageProvider><BillForm key={++generation} draftUserId={user} accountSlot={account} onCreated={() => { harness.saves++; root.render(<p>Issued in fixture only</p>); }} /></LanguageProvider>);
}, dialog() { root.render(<LanguageProvider><BillChangeReasonDialog onDone={reason => { harness.reason = reason ?? "cancelled"; root.render(<p>Dialog closed</p>); }} /></LanguageProvider>); } };
Object.assign(window, { draftHarness: harness });
window.confirm = () => true;
window.fetch = async (input, init) => {
  const url = String(input);
  if (!init?.method || init.method === "GET") return new Response(JSON.stringify(url.includes("/jewellery") ? { items: ["Ring", "Haram", "Necklace"] } : { customer: null, customers: [] }), { headers: { "content-type": "application/json" } });
  if (!url.includes("/api/bills") || init.method !== "POST") throw new Error("Unexpected fixture request");
  const id = new Headers(init.headers).get("x-billing-operation-id") ?? "";
  const body = String(init.body);
  harness.requests.push({ id, body });
  if (!id) throw new Error("Missing safe-save request ID");
  if (harness.fail) return new Response(JSON.stringify({ error: "Fixture save rejected", issuanceCommitted: false }), { status: 400, headers: { "content-type": "application/json" } });
  const key = `fixture-issued-${id}`;
  const existing = sessionStorage.getItem(key);
  if (existing && existing !== body) throw new Error("Retry changed the submitted bill");
  sessionStorage.setItem(key, body);
  if (harness.loseResponse) throw new TypeError("Fixture response lost after save");
  return new Response(JSON.stringify({ bill: { id } }), { headers: { "content-type": "application/json" } });
};
harness.mount();
