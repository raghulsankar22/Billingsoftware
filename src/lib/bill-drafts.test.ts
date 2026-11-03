import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { billDraftKey, hasBillDraftContent, makeBillDraft, parseBillDraft } from "./bill-drafts";

const input = { billDate: "2026-11-03", customerName: "முத்து", fatherName: "Parent", address: "தமிழ் முகவரி", phone: "1234567890", governmentId: "123456789012", customerId: randomUUID(), deliveryNo: "must-not-resume", deliveryDate: "2026-12-01", items: [{ metal: "Gold" as const, particulars: "மோதிரம்", remarks: "Dent", grams: 2, assessedValue: 110, loanAmount: 100 }] };
describe("unfinished new bill drafts", () => {
  it("retains the exact frozen request and its retry ID until issuance is resolved", () => {
    const submission = { id: randomUUID(), body: JSON.stringify(input) };
    const parsed = parseBillDraft(JSON.stringify(makeBillDraft(randomUUID(), input, {}, submission)));
    expect(parsed?.submission).toEqual(submission);
    expect(JSON.parse(parsed!.submission!.body).customerId).toBe(input.customerId);
    expect(parseBillDraft(JSON.stringify({ ...parsed, submission: { ...submission, id: "bad" } }))).toBeNull();
  });
  it("isolates users and business accounts", () => {
    expect(new Set([billDraftKey("user-one", 1), billDraftKey("user-one", 2), billDraftKey("user-two", 1)]).size).toBe(3);
  });
  it("keeps entered English/Tamil exactly, strips customer links and delivery state, and preserves pending jewellery", () => {
    const draft = makeBillDraft(randomUUID(), input, { 0: { name: "Ring", quantity: "2", error: "old error", query: "hrm" } });
    const parsed = parseBillDraft(JSON.stringify(draft));
    expect(parsed?.form).toMatchObject({ customerName: "முத்து", address: "தமிழ் முகவரி", governmentId: "123456789012", items: input.items });
    expect(parsed?.form).not.toHaveProperty("customerId"); expect(parsed?.form).not.toHaveProperty("deliveryNo");
    expect(parsed?.jewellery[0]).toEqual({ name: "Ring", quantity: "2", error: "", query: "hrm" });
  });
  it("rejects malformed, oversized and invalid versions instead of trusting browser storage", () => {
    for (const value of [null, "bad json", "x".repeat(150001), JSON.stringify({ version: 2 }), JSON.stringify({ ...makeBillDraft(randomUUID(), input, {}), form: { ...input, items: [] } })]) expect(parseBillDraft(value)).toBeNull();
  });
  it("does not save empty forms or issue a number as part of draft creation", () => {
    const empty = { billDate: "2026-11-03", customerName: "", fatherName: "", address: "", phone: "", items: [{ particulars: "", grams: 0, assessedValue: 0, loanAmount: 0 }] };
    expect(hasBillDraftContent(empty, {})).toBe(false); expect(hasBillDraftContent(empty, { 0: { name: "", quantity: "2", error: "" } })).toBe(true);
    expect(makeBillDraft(randomUUID(), input, {})).not.toHaveProperty("billNumber");
  });
  it("keeps the selected Particulars prefix for safe completion after resuming", () => {
    const draft = makeBillDraft(randomUUID(), input, { 0: { name: "Haram", quantity: "2", error: "", prefix: "Ring 2" } });
    expect(parseBillDraft(JSON.stringify(draft))?.jewellery[0].prefix).toBe("Ring 2");
  });
});
