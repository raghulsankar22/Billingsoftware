import React from "react";
import { createRoot } from "react-dom/client";
import { BillForm } from "../src/components/bill-form";
import { LanguageProvider } from "../src/components/language-provider";

window.fetch = async (_input, init) => {
  if (init?.method && init.method !== "GET") throw new Error("This test cannot write billing data.");
  return new Response(JSON.stringify({ items: ["Ring", "Ladies Ring", "Studs", "Haram", "Necklace", "புதிய நகை"] }), { headers: { "Content-Type": "application/json" } });
};

createRoot(document.getElementById("root")!).render(<LanguageProvider><BillForm accountSlot={1} onCreated={() => { throw new Error("This test must not create a bill."); }} /></LanguageProvider>);
