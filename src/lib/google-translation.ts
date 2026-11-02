import { z } from "zod";
import { containsTamil } from "./english-records";
import { googleTranslationErrors, googleTranslationLimits, splitTranslationText, type GoogleTranslationErrorCode, type GoogleTranslationInput } from "./google-translation-input";

export class GoogleTranslationError extends Error {
  constructor(readonly code: GoogleTranslationErrorCode, readonly status: number) { super(googleTranslationErrors[code]); }
}

const schema = z.object({
  text: z.string().trim().min(1).max(500), field: z.enum(["customerName", "fatherName", "address"]),
  source: z.enum(["en", "ta"]), target: z.enum(["en", "ta"]), consent: z.literal(true),
}).strict();

export function parseGoogleTranslationInput(value: unknown): GoogleTranslationInput {
  const result = schema.safeParse(value);
  if (!result.success || result.data.source === result.data.target || result.data.text.length > googleTranslationLimits[result.data.field]) throw new GoogleTranslationError("invalid", 400);
  if (result.data.source === "en" && containsTamil(result.data.text)) throw new GoogleTranslationError("invalid", 400);
  return result.data;
}

export async function readTranslationJson(message: Pick<Request, "body">, maximumBytes: number): Promise<unknown> {
  if (!message.body) throw new GoogleTranslationError("invalid", 400);
  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new GoogleTranslationError("invalid", 413);
      }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof GoogleTranslationError) throw error;
    throw new GoogleTranslationError("invalid", 400);
  } finally { reader.releaseLock(); }
}

function decodeGoogleText(text: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (entity, code: string) => {
    if (!code.startsWith("#")) return entities[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  });
}

export async function translateWithGoogle(input: GoogleTranslationInput, apiKey: string): Promise<string> {
  const { parts, indices } = splitTranslationText(input.text);
  if (!indices.length || indices.length > 24) throw new GoogleTranslationError("invalid", 400);
  const query = indices.map(index => parts[index]);
  try {
    const response = await fetch("https://translation.googleapis.com/language/translate/v2", {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ q: query, source: input.source, target: input.target, format: "text", model: "nmt" }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new GoogleTranslationError("unavailable", 503); }
    let payload: unknown;
    try { payload = await readTranslationJson(response, 32768); } catch { throw new GoogleTranslationError("invalidResult", 502); }
    const output = z.object({ data: z.object({ translations: z.array(z.object({ translatedText: z.string().max(2000) })) }) }).safeParse(payload);
    if (!output.success || output.data.data.translations.length !== indices.length) throw new GoogleTranslationError("invalidResult", 502);
    output.data.data.translations.forEach((translation, index) => {
      const text = decodeGoogleText(translation.translatedText);
      if (!text.trim() || /[\p{N}₹$€£]/u.test(text) || (input.target === "en" && containsTamil(text))) throw new GoogleTranslationError("invalidResult", 502);
      const source = parts[indices[index]];
      parts[indices[index]] = (source.match(/^\s*/u)?.[0] ?? "") + text.trim() + (source.match(/\s*$/u)?.[0] ?? "");
    });
    const result = parts.join("");
    if (result.length > 2500) throw new GoogleTranslationError("invalidResult", 502);
    return result;
  } catch (error) {
    if (error instanceof GoogleTranslationError) throw error;
    throw new GoogleTranslationError("unavailable", 503);
  }
}

export class GoogleTranslationLimiter {
  private buckets = new Map<string, { count: number; started: number }>();
  allow(userId: string, now = Date.now()): boolean {
    for (const [key, value] of this.buckets) if (now - value.started >= 60000) this.buckets.delete(key);
    const userKey = "user:" + userId;
    if (!this.buckets.has(userKey) && this.buckets.size >= 1000) return false;
    const global = this.buckets.get("global") ?? { count: 0, started: now };
    const user = this.buckets.get(userKey) ?? { count: 0, started: now };
    if (global.count >= 60 || user.count >= 20) return false;
    this.buckets.set("global", { count: global.count + 1, started: global.started });
    this.buckets.set(userKey, { count: user.count + 1, started: user.started });
    return true;
  }
}
