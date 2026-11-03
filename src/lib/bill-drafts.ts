import { z } from "zod";
import type { BillInput } from "./types";

export const billDraftPrefix = "finance-billing-draft:v1:";
const text = z.string().max(1000);
const amount = z.number().finite().min(0).max(100_000_000);
const submissionSchema = z.object({ id: z.string().uuid(), body: z.string().min(2).max(75_000) });
export type BillSubmission = z.infer<typeof submissionSchema>;
const draftSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), savedAt: z.string().datetime(),
  form: z.object({ billDate: z.string().max(10), customerName: text, fatherName: text, address: text, phone: text, governmentId: text.optional(),
    items: z.array(z.object({ metal: z.enum(["Gold", "Silver"]).optional(), particulars: text, remarks: text.optional(), grams: amount, assessedValue: amount, loanAmount: amount })).min(1).max(30) }),
  jewellery: z.record(z.string(), z.object({ name: text, quantity: z.string().max(20), error: z.literal(""), query: text.nullable().optional(), prefix: text.optional() })),
  submission: submissionSchema.optional(),
});
export type BillDraft = z.infer<typeof draftSchema>;
export type JewelleryDrafts = Record<number, { name: string; quantity: string; error: string; query?: string | null; prefix?: string }>;
export function billDraftKey(userId: string, account: number) { return `${billDraftPrefix}${encodeURIComponent(userId)}:${account}`; }
export function parseBillDraft(raw: string | null): BillDraft | null {
  try { if (!raw || raw.length > 150_000) return null; return draftSchema.parse(JSON.parse(raw)); } catch { return null; }
}
export function makeBillDraft(id: string, form: BillInput, jewellery: JewelleryDrafts, submission?: BillSubmission): BillDraft {
  return draftSchema.parse({ version: 1, id, savedAt: new Date().toISOString(), form, jewellery: Object.fromEntries(Object.entries(jewellery).map(([index, value]) => [index, { ...value, error: "" }])), ...(submission ? { submission } : {}) });
}
export function hasBillDraftContent(form: BillInput, jewellery: JewelleryDrafts) {
  return Boolean(form.customerName || form.fatherName || form.address || form.phone || form.governmentId || form.items.some(item => item.particulars || item.remarks || item.metal || item.grams || item.loanAmount) || Object.values(jewellery).some(item => item.name || item.quantity || item.query));
}
