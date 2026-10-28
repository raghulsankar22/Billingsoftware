import { z } from "zod";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD format.").refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Choose a valid calendar date.");

const precision = (value: number, scale: number) => Math.abs(value * scale - Math.round(value * scale)) <= Number.EPSILON * Math.max(1, Math.abs(value * scale)) * 4;
const moneySchema = z.coerce.number().finite().positive().max(100_000_000).refine((value) => precision(value, 100), "Amounts can have up to two decimal places.");

export const deliverySchema = z.object({
  deliveryDate: dateSchema,
  itemMetals: z.array(z.enum(["Gold", "Silver"]).nullable()).max(30).optional(),
});

export const billSchema = z.object({
  deliveryNo: z.string().max(60).optional().or(z.literal("")),
  deliveryDate: dateSchema.optional().or(z.literal("")),
  billDate: dateSchema,
  customerName: z.string().trim().min(2).max(120),
  fatherName: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(500),
  phone: z.string().trim().max(20).refine((phone) => !phone || phone.length >= 7, "Mobile numbers must have at least 7 characters.").default(""),
  governmentId: z.string().trim().max(80).optional().or(z.literal("")),
  items: z.array(z.object({
    metal: z.enum(["Gold", "Silver"]).optional(),
    particulars: z.string().trim().min(2).max(180),
    grams: z.coerce.number().finite().min(0).max(100_000).refine((value) => precision(value, 1000), "Grams can have up to three decimal places."),
    assessedValue: moneySchema,
    loanAmount: moneySchema,
  })).min(1).max(30),
});
