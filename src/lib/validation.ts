import { z } from "zod";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD format.").refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Choose a valid calendar date.");

const precision = (value: number, scale: number) => Math.abs(value * scale - Math.round(value * scale)) <= Number.EPSILON * Math.max(1, Math.abs(value * scale)) * 4;
const moneySchema = z.coerce.number().finite().positive().max(100_000_000).refine((value) => precision(value, 100), "Amounts can have up to two decimal places.");
const billReceiptStatusSchema = z.enum(["has_bill", "lost_bill"], { required_error: "Choose whether the customer has the bill or lost the bill.", invalid_type_error: "Choose whether the customer has the bill or lost the bill." });

export const historicalImportSchema = z.array(z.object({
  billNo: z.number().int().min(1).max(2147483646), billDate: dateSchema,
  deliveryNo: z.string().max(60), deliveryDate: dateSchema.nullable(),
  name: z.string().trim().min(1).max(120), address: z.string().trim().max(500),
  particulars: z.string().trim().min(1).max(180), phone: z.string().trim().max(20),
  amount: moneySchema, metal: z.enum(["Gold", "Silver"]),
})).min(1).max(10000);

export const deliverySchema = z.object({
  deliveryDate: dateSchema,
  billReceiptStatus: billReceiptStatusSchema,
  itemMetals: z.array(z.enum(["Gold", "Silver"]).nullable()).max(30).optional(),
});

export const batchDeliverySchema = z.object({
  deliveryDate: dateSchema,
  deliveries: z.array(z.object({
    billId: z.string().uuid(),
    billReceiptStatus: billReceiptStatusSchema,
    itemMetals: z.array(z.enum(["Gold", "Silver"]).nullable()).max(30).optional(),
  })).min(1, "Add at least one bill for delivery.").max(50, "You can deliver up to 50 bills together.")
    .refine(deliveries => new Set(deliveries.map(delivery => delivery.billId)).size === deliveries.length, "Each bill can appear only once."),
});

export const billSchema = z.object({
  customerId: z.string().uuid("Choose a saved customer.").or(z.literal("")).optional(),
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
    remarks: z.string().trim().max(180, "Remarks must be at most 180 characters.").optional(),
    grams: z.coerce.number().finite().min(0).max(100_000).refine((value) => precision(value, 1000), "Grams can have up to three decimal places."),
    assessedValue: moneySchema,
    loanAmount: moneySchema,
  })).min(1).max(30),
});
