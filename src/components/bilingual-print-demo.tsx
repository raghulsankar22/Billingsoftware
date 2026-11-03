"use client";

import { useState } from "react";
import Link from "next/link";
import { BillDocument } from "./bill-document";
import { amountInWords } from "@/lib/money";
import { jewelleryLabel, starterJewellery } from "@/lib/jewellery";
import type { Bill, BusinessSnapshot } from "@/lib/types";

const profile: BusinessSnapshot = { business_name: "DEMO - Sample Finance", address: "Chennai", phone: "0000000000" };
const sample: Bill = {
  id: "synthetic-bilingual-preview", billNumber: 1, billDate: "2026-11-02",
  customerName: "Kumar", fatherName: "Muthu", address: "Chennai",
  phone: "0000000000", items: [{ metal: "Gold", particulars: "Ring", grams: 5, assessedValue: 40000, loanAmount: 25000 }],
  totalAssessedValue: 40000, totalLoanAmount: 25000, amountInWords: amountInWords(25000),
  status: "issued", excelSyncStatus: "pending", createdAt: "2026-11-02T00:00:00Z",
};

export function BilingualPrintDemo() {
  const [particulars, setParticulars] = useState("Ring");
  const [opened, setOpened] = useState(false);
  const bill = { ...sample, items: [{ ...sample.items[0], particulars }] };
  return <main className="bilingual-demo-page"><section className="panel">
    <p className="eyebrow">LIVE WEBSITE PREVIEW · SAMPLE ONLY</p>
    <h1>English bills with Tamil jewellery names</h1>
    <p>Names, addresses and saved records stay English. Tamil appears only in brackets beside known jewellery particulars. Nothing on this page is saved.</p>
    <label>Particulars<select value={particulars} onChange={event => setParticulars(event.target.value)}>{starterJewellery.map(name => <option key={name} value={name}>{jewelleryLabel(name)}</option>)}</select></label>
    <button type="button" onClick={() => setOpened(true)}>Open sample bill</button>
    <p><Link href="/">Open the sample billing website</Link></p>
  </section>{opened && <BillDocument bill={bill} profile={profile} accountSlot={1} previewOnly onClose={() => setOpened(false)} />}</main>;
}
