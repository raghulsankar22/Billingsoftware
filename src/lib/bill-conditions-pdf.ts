import PDFKit from "pdfkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { billConditions as conditions } from "./bill-conditions";

type ConditionsBlock = { bytes: Uint8Array; width: number; height: number };
let block: Promise<ConditionsBlock> | undefined;

export function createConditionsBlock(): Promise<ConditionsBlock> {
  if (block) return block;
  block = new Promise((resolve, reject) => {
    const width = 180 * 72 / 25.4;
    const regular = readFileSync(join(process.cwd(), "public/fonts/NotoSansTamil-Regular.ttf"));
    const bold = readFileSync(join(process.cwd(), "public/fonts/NotoSansTamil-Bold.ttf"));
    const latin = readFileSync(join(process.cwd(), "public/fonts/NotoSans-Regular.ttf"));
    const latinBold = readFileSync(join(process.cwd(), "public/fonts/NotoSans-Bold.ttf"));
    // PDFKit shapes Tamil conjuncts and vowel marks into real, selectable PDF text.
    const doc = new PDFKit({ autoFirstPage: false, compress: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.addPage({ size: [width, 842], margin: 0 });
    doc.registerFont("Conditions", latin);
    doc.registerFont("ConditionsBold", latinBold);
    doc.registerFont("Tamil", regular);
    doc.registerFont("TamilBold", bold);
    const text = (value: string, options: { bold?: boolean; center?: boolean; right?: boolean; indent?: number; size?: number; gap?: number } = {}) => {
      const indent = options.indent ?? 0;
      const top = doc.y;
      const size = options.size ?? 8;
      type Run = { value: string; font: string; width: number };
      const lines: Run[][] = [[]];
      let used = 0;
      for (const word of value.split(/(\n|[^\S\n]+)/u).filter(Boolean)) {
        if (word === "\n") { lines.push([]); used = 0; continue; }
        const runs = (word.match(/[\u0B80-\u0BFF]+|[^\u0B80-\u0BFF]+/gu) ?? []).map((run) => {
          const font = `${/[\u0B80-\u0BFF]/u.test(run) ? "Tamil" : "Conditions"}${options.bold ? "Bold" : ""}`;
          doc.font(font).fontSize(size);
          return { value: run, font, width: doc.widthOfString(run) };
        });
        const length = runs.reduce((sum, run) => sum + run.width, 0);
        if (word.trim() && used + length > width - indent && lines.at(-1)!.length) { lines.push([]); used = 0; }
        if (!word.trim() && used === 0) continue;
        lines.at(-1)!.push(...runs);
        used += length;
      }
      const lineHeight = size * (/[\u0B80-\u0BFF]/u.test(value) ? 1.7 : 1.45);
      lines.forEach((runs, index) => {
        while (runs.length && !runs.at(-1)!.value.trim()) runs.pop();
        const length = runs.reduce((sum, run) => sum + run.width, 0);
        let x = indent + (options.center ? (width - indent - length) / 2 : options.right ? width - indent - length : 0);
        runs.forEach((run) => {
          doc.font(run.font).fontSize(size).text(run.value, x, top + index * lineHeight, { lineBreak: false });
          x += run.width;
        });
      });
      doc.y = top + lines.length * lineHeight + (options.gap ?? 4);
    };
    text(conditions.heading, { bold: true, center: true, size: 10, gap: 6 });
    text(`${conditions.interest}\n${conditions.interestExplanation}`);
    conditions.clauses.forEach((clause, index) => {
      const top = doc.y;
      doc.font("Conditions").fontSize(8).text(`${index + 1}.`, 0, top, { width: 15 });
      doc.y = top;
      text(clause, { indent: 16 });
    });
    text(conditions.redemption, { center: true });
    text(conditions.holidays, { center: true, bold: true });
    conditions.tamilNotices.forEach((notice) => text(notice, { center: true, bold: true, size: 8.5 }));
    text(conditions.tamilSignature, { right: true });
    const hoursTop = doc.y;
    text(conditions.hoursHeading, { bold: true });
    doc.y = hoursTop;
    text(`${conditions.morning}\n${conditions.evening}`, { indent: 100 });
    text(conditions.addressNotice, { bold: true });
    const height = doc.y + 2;
    doc.on("end", () => resolve({ bytes: new Uint8Array(Buffer.concat(chunks)), width, height }));
    doc.end();
  });
  block.catch(() => { block = undefined; });
  return block;
}
