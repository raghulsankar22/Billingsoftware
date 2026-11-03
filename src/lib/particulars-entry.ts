import { appendJewelleryParticulars } from "./jewellery";
import { capitalizeWords } from "./text-case";
import type { JewelleryDrafts } from "./bill-drafts";
import type { BillInput } from "./types";

export function particularsEntry(value: string) {
  const text = value.trimEnd();
  if (/\S\s+[1-9]\d{0,3}$/u.test(text)) return { prefix: text.trim(), query: "" };
  const separator = value.lastIndexOf(",");
  return { prefix: separator < 0 ? "" : value.slice(0, separator).trim(), query: value.slice(separator + 1).trim() };
}

export function selectedParticulars(prefix: string, name: string) {
  const value = capitalizeWords([prefix, name].filter(Boolean).join(", "));
  if (value.length > 180) throw new Error("Particulars can have up to 180 characters. Shorten the description before adding more jewellery.");
  return value;
}

export function completeParticulars(value: string, name: string, quantity: string, prefix?: string) {
  if (prefix !== undefined && value !== selectedParticulars(prefix, name)) throw new Error("Select jewellery to add.");
  return appendJewelleryParticulars(prefix ?? value, name, quantity);
}

export function resumeParticularsDraft(form: BillInput, drafts: JewelleryDrafts) {
  const items = form.items.map(row => ({ ...row }));
  const jewellery = { ...drafts };
  for (const [key, draft] of Object.entries(drafts)) {
    const index = Number(key);
    if (!items[index] || draft.prefix !== undefined || (!draft.name && draft.query == null)) continue;
    const prefix = items[index].particulars.trim();
    const typed = draft.query ?? draft.name;
    const text = [prefix, typed].filter(Boolean).join(", ");
    items[index].particulars = draft.query != null ? text : capitalizeWords(text);
    jewellery[index] = { ...draft, name: draft.query != null ? "" : draft.name, query: null, prefix: draft.query != null ? undefined : prefix };
  }
  return { form: { ...form, items }, jewellery };
}
