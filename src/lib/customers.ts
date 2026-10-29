import { z } from "zod";

export interface CustomerInput {
  name: string;
  fatherName: string;
  address: string;
  phone: string;
  aadhaar: string;
}

export interface Customer extends CustomerInput {
  id: string;
  customerCode: string;
  createdAt: string;
  updatedAt: string;
}

export function customerCode(number: number): string {
  return `C${String(number).padStart(6, "0")}`;
}

/** Store the same phone key for local and +91 formatted Indian numbers. */
export function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s()-]/g, "");
  if (compact.startsWith("+91")) return compact.slice(3);
  return /^91\d{10}$/.test(compact) ? compact.slice(2) : compact;
}

export function normalizeAadhaar(value: string): string {
  return value.trim().replace(/[\s-]/g, "");
}

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer's name.").max(120),
  fatherName: z.string().trim().min(2, "Enter the father's name.").max(120),
  address: z.string().trim().min(5, "Enter the customer's address.").max(500),
  phone: z.string().max(80).default("").transform(normalizePhone)
    .refine(value => !value || /^\d{10}$/.test(value), "Enter a 10-digit phone number, optionally with +91."),
  aadhaar: z.string().max(80).default("").transform(normalizeAadhaar)
    .refine(value => !value || /^\d{12}$/.test(value), "Enter a 12-digit Aadhaar number."),
});
