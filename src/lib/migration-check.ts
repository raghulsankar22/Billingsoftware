/** Read-only structural checks run before any local ledger is transferred. */
type Row = Record<string, unknown>;
export type MigrationSnapshot = { profiles: Row[]; bills: Row[]; items: Row[]; customers: Row[] };
export type MigrationCheck = { ok: boolean; issues: string[]; counts: { profiles: number; bills: number; items: number; customers: number }; loanPaise: number };

function id(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483646; }
/** The ₹10 crore limit applies to each item; a bill's total may legitimately exceed it. */
function moneyPaise(value: unknown, maximum = 100_000_000): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > maximum) return null;
  const paise = Math.round(value * 100);
  return Math.abs(paise / 100 - value) <= 0.0000001 ? paise : null;
}

export function checkMigrationSnapshot(snapshot: MigrationSnapshot): MigrationCheck {
  const issues: string[] = [];
  const profiles = new Map<string, Row>(); const bills = new Map<string, Row>();
  const customers = new Map<string, Row>(); const itemsByBill = new Map<string, Row[]>();
  const slots = new Set<number>(); const customerNumbers = new Set<number>(); const numbers = new Set<string>();
  snapshot.profiles.forEach((profile, index) => {
    if (!id(profile.id) || profiles.has(profile.id)) { issues.push(`Profile ${index + 1}: invalid or duplicate ID`); return; }
    profiles.set(profile.id, profile);
    if (!positiveInteger(profile.account_slot) || slots.has(profile.account_slot)) issues.push(`Profile ${index + 1}: invalid or duplicate account number`);
    else slots.add(profile.account_slot);
  });
  snapshot.customers.forEach((customer, index) => {
    if (!id(customer.id) || customers.has(customer.id)) { issues.push(`Customer ${index + 1}: invalid or duplicate ID`); return; }
    customers.set(customer.id, customer);
    if (!id(customer.profile_id) || !profiles.has(customer.profile_id)) issues.push(`Customer ${index + 1}: business account not found`);
    if (!positiveInteger(customer.customer_number) || customerNumbers.has(customer.customer_number)) issues.push(`Customer ${index + 1}: invalid or duplicate customer number`);
    else customerNumbers.add(customer.customer_number);
  });
  snapshot.customers.forEach((customer, index) => {
    if (customer.canonical_id != null && (!id(customer.canonical_id) || !customers.has(customer.canonical_id))) issues.push(`Customer ${index + 1}: linked customer not found`);
  });
  let loanPaise = 0;
  snapshot.bills.forEach((bill, index) => {
    if (!id(bill.id) || bills.has(bill.id)) { issues.push(`Bill ${index + 1}: invalid or duplicate ID`); return; }
    bills.set(bill.id, bill);
    if (!id(bill.profile_id) || !profiles.has(bill.profile_id)) issues.push(`Bill ${index + 1}: business account not found`);
    const numberKey = `${bill.profile_id}:${bill.bill_number}`;
    if (!positiveInteger(bill.bill_number) || numbers.has(numberKey)) issues.push(`Bill ${index + 1}: invalid or duplicate bill number`);
    else numbers.add(numberKey);
    if (bill.customer_id != null && (!id(bill.customer_id) || !customers.has(bill.customer_id))) issues.push(`Bill ${index + 1}: linked customer not found`);
    const value = moneyPaise(bill.total_loan_amount, Number.MAX_SAFE_INTEGER / 100);
    if (value === null || !Number.isSafeInteger(loanPaise + value)) issues.push(`Bill ${index + 1}: invalid loan amount`);
    else loanPaise += value;
  });
  const itemIds = new Set<string>();
  snapshot.items.forEach((item, index) => {
    if (!id(item.id) || itemIds.has(item.id)) issues.push(`Item ${index + 1}: invalid or duplicate ID`);
    else itemIds.add(item.id);
    if (!id(item.bill_id) || !bills.has(item.bill_id)) { issues.push(`Item ${index + 1}: bill not found`); return; }
    if (moneyPaise(item.loan_amount) === null) issues.push(`Item ${index + 1}: invalid loan amount`);
    itemsByBill.set(item.bill_id, [...(itemsByBill.get(item.bill_id) ?? []), item]);
  });
  snapshot.bills.forEach((bill, index) => {
    if (!id(bill.id)) return;
    const items = itemsByBill.get(bill.id) ?? [];
    if (!items.length) { issues.push(`Bill ${index + 1}: no item records`); return; }
    const amounts = items.map(item => moneyPaise(item.loan_amount));
    if (amounts.every(value => value !== null) && amounts.reduce<number>((sum, value) => sum + (value ?? 0), 0) !== moneyPaise(bill.total_loan_amount, Number.MAX_SAFE_INTEGER / 100)) issues.push(`Bill ${index + 1}: item amounts do not match the bill total`);
    if (bill.replacement_for_id != null) {
      const original = typeof bill.replacement_for_id === "string" ? bills.get(bill.replacement_for_id) : undefined;
      if (!original || original.profile_id !== bill.profile_id) issues.push(`Bill ${index + 1}: replacement bill link is invalid`);
    }
  });
  return { ok: issues.length === 0, issues, counts: { profiles: snapshot.profiles.length, bills: snapshot.bills.length, items: snapshot.items.length, customers: snapshot.customers.length }, loanPaise };
}
