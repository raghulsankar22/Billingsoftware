import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { checkMigrationSnapshot, type MigrationSnapshot } from "./migration-check";

function snapshot(): MigrationSnapshot {
  const profile = randomUUID(), bill = randomUUID(), customer = randomUUID();
  return {
    profiles: [{ id: profile, account_slot: 1 }],
    customers: [{ id: customer, profile_id: profile, customer_number: 1, canonical_id: customer, name: "PRIVATE NAME" }],
    bills: [{ id: bill, profile_id: profile, bill_number: 1, total_loan_amount: 10000.25, customer_id: customer }],
    items: [{ id: randomUUID(), bill_id: bill, loan_amount: 4000.1 }, { id: randomUUID(), bill_id: bill, loan_amount: 6000.15 }],
  };
}

it("checks totals in paise without exposing private names", () => {
  const result = checkMigrationSnapshot(snapshot());
  expect(result).toMatchObject({ ok: true, loanPaise: 1000025, counts: { profiles: 1, bills: 1, items: 2, customers: 1 } });
  expect(JSON.stringify(result)).not.toContain("PRIVATE NAME");
});

it("flags duplicate bill numbers, missing account links and mismatched totals before migration", () => {
  const data = snapshot();
  data.bills.push({ ...data.bills[0], id: randomUUID() });
  data.items[0].loan_amount = 1;
  data.customers[0].profile_id = randomUUID();
  const result = checkMigrationSnapshot(data);
  expect(result.ok).toBe(false);
  expect(result.issues.join("; ")).toMatch(/duplicate bill number/);
  expect(result.issues.join("; ")).toMatch(/business account not found/);
  expect(result.issues.join("; ")).toMatch(/item amounts do not match/);
});

it("rejects a replacement link that points into a different business account", () => {
  const data = snapshot();
  const otherProfile = randomUUID(), otherBill = randomUUID();
  data.profiles.push({ id: otherProfile, account_slot: 2 });
  data.bills.push({ id: otherBill, profile_id: otherProfile, bill_number: 1, total_loan_amount: 100 });
  data.items.push({ id: randomUUID(), bill_id: otherBill, loan_amount: 100 });
  data.bills[0].replacement_for_id = otherBill;
  expect(checkMigrationSnapshot(data).issues.join("; ")).toMatch(/replacement bill link is invalid/);
});
