import type { Bill, BillItemInput } from "./types";

const maxQuantity = 9999;

/**
 * Read quantities only when every comma-separated entry ends in an explicit,
 * positive whole quantity. Older free-form descriptions stay unknown.
 */
export function stockQuantity(particulars: string): number | null {
  const entries = particulars.split(",");
  let total = 0;

  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    const match = /^(.+\S)\s+(\d+)$/.exec(entry);
    if (!match) return null;

    const quantity = Number(match[2]);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > maxQuantity) return null;

    total += quantity;
    if (!Number.isSafeInteger(total)) return null;
  }

  return total;
}

export type JewelStockLine = {
  bill: Bill;
  item: BillItemInput;
  index: number;
  quantity: number | null;
};

export type JewelStock = {
  lines: JewelStockLine[];
  billCount: number;
  pledgeRows: number;
  knownPieces: number;
  unknownQuantityRows: number;
  grams: number;
  loanAmount: number;
  assessedValue: number;
  unknownMetalRows: number;
};

function isDelivered(bill: Bill) {
  return Boolean(bill.deliveryNo?.trim() && bill.deliveryDate?.trim());
}

function isKnownMetal(metal: BillItemInput["metal"]): metal is "Gold" | "Silver" {
  return metal === "Gold" || metal === "Silver";
}

function paise(amount: number) {
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function milligrams(grams: number) {
  return Number.isFinite(grams) ? Math.round(grams * 1000) : 0;
}

/**
 * Summarize all undelivered pledge rows, including voided bills. When a metal
 * is selected, only matching rows contribute to the totals; unknownMetalRows
 * remains a warning count across all undelivered rows.
 */
export function jewelStock(bills: readonly Bill[], metal?: "Gold" | "Silver"): JewelStock {
  const pendingBills = bills.filter(bill => !isDelivered(bill));
  const unknownMetalRows = pendingBills.reduce((count, bill) =>
    count + bill.items.filter(item => !isKnownMetal(item.metal)).length, 0);

  const lines: JewelStockLine[] = [];
  for (const bill of pendingBills) {
    bill.items.forEach((item, index) => {
      if (metal && item.metal !== metal) return;
      lines.push({ bill, item, index, quantity: stockQuantity(item.particulars) });
    });
  }

  lines.sort((left, right) => left.bill.billDate.localeCompare(right.bill.billDate)
    || left.bill.billNumber - right.bill.billNumber
    || left.bill.id.localeCompare(right.bill.id)
    || left.index - right.index);

  let loanPaise = 0;
  let assessedPaise = 0;
  let totalMilligrams = 0;
  let knownPieces = 0;
  let unknownQuantityRows = 0;
  for (const { item, quantity } of lines) {
    loanPaise += paise(item.loanAmount);
    assessedPaise += paise(item.assessedValue);
    totalMilligrams += milligrams(item.grams);
    if (quantity === null) unknownQuantityRows += 1;
    else knownPieces += quantity;
  }

  return {
    lines,
    billCount: new Set(lines.map(line => line.bill.id)).size,
    pledgeRows: lines.length,
    knownPieces,
    unknownQuantityRows,
    grams: totalMilligrams / 1000,
    loanAmount: loanPaise / 100,
    assessedValue: assessedPaise / 100,
    unknownMetalRows,
  };
}
