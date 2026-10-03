import { z } from "zod";

export const billSchema = z.object({
  deliveryNo: z.string().max(60).optional().or(z.literal("")),
  deliveryDate: z.string().optional().or(z.literal("")),
  billDate: z.string().min(10),
  customerName: z.string().trim().min(2).max(120),
  fatherName: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(500),
  phone: z.string().trim().min(7).max(20),
  governmentId: z.string().trim().max(80).optional().or(z.literal("")),
  items: z.array(z.object({
    particulars: z.string().trim().min(2).max(180),
    grams: z.coerce.number().min(0).max(100_000),
    assessedValue: z.coerce.number().positive().max(100_000_000),
    loanAmount: z.coerce.number().positive().max(100_000_000),
  })).min(1).max(30),
});
