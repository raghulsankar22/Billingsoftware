import { z } from "zod";
import { isEnglishRecord, englishRecordMessage } from "./english-records";

export const profileSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  address: z.string().trim().min(5).max(500),
  phone: z.string().trim().min(7).max(20).refine(isEnglishRecord, englishRecordMessage),
  licenseNumber: z.string().trim().max(80).optional(),
  logoUrl: z.string().url().max(2048).optional().or(z.literal("")),
  nextBillNumber: z.coerce.number().int().positive().max(2_147_483_646).optional(),
});
