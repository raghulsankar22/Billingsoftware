import PDFKit from "pdfkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ParticularsBlock = { pageIndex: number; width: number; height: number };
export type PdfTextRequest = { value: string; width: number; size?: number; bold?: boolean; align?: "left" | "center" | "right" };
export const pdfTextKey = (request: PdfTextRequest) => JSON.stringify([request.value, request.width, request.size ?? 9, request.bold ?? false, request.align ?? "left"]);

export async function createParticularsBlocks(values: string[], width: number): Promise<{ bytes: Uint8Array; blocks: Map<string, ParticularsBlock> }> {
  const result = await createTextBlocks(values.map(value => ({ value, width })));
  return { bytes: result.bytes, blocks: new Map(values.map(value => [value, result.blocks.get(pdfTextKey({ value, width }))!])) };
}

export async function createTextBlocks(requests: PdfTextRequest[]): Promise<{ bytes: Uint8Array; blocks: Map<string, ParticularsBlock> }> {
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ autoFirstPage: false, compress: true });
    const chunks: Buffer[] = [];
    const blocks = new Map<string, ParticularsBlock>();
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.registerFont("Latin", readFileSync(join(process.cwd(), "public/fonts/NotoSans-Regular.ttf")));
    doc.registerFont("Tamil", readFileSync(join(process.cwd(), "public/fonts/NotoSansTamil-Regular.ttf")));
    doc.registerFont("LatinBold", readFileSync(join(process.cwd(), "public/fonts/NotoSans-Bold.ttf")));
    doc.registerFont("TamilBold", readFileSync(join(process.cwd(), "public/fonts/NotoSansTamil-Bold.ttf")));
    const segmenter = new Intl.Segmenter("ta", { granularity: "grapheme" });
    type Run = { value: string; font: string; width: number };
    const runsFor = (value: string, size: number, bold: boolean): Run[] => (value.match(/[\u0B80-\u0BFF]+|[^\u0B80-\u0BFF]+/gu) ?? []).map(value => {
      const font = (/[\u0B80-\u0BFF]/u.test(value) ? "Tamil" : "Latin") + (bold ? "Bold" : "");
      doc.font(font).fontSize(size);
      return { value, font, width: doc.widthOfString(value) };
    });
    for (const request of requests) {
      const key = pdfTextKey(request);
      if (blocks.has(key)) continue;
      const { value, width, size = 9, bold = false, align = "left" } = request;
      const lineHeight = size * 1.7;
      doc.addPage({ size: [width, 842], margin: 0 });
      const lines: Run[][] = [[]];
      let used = 0;
      const append = (text: string) => {
        const runs = runsFor(text, size, bold);
        const length = runs.reduce((sum, run) => sum + run.width, 0);
        if (text.trim() && used + length > width && lines.at(-1)!.length) { lines.push([]); used = 0; }
        if (!text.trim() && used === 0) return;
        lines.at(-1)!.push(...runs);
        used += length;
      };
      for (const word of value.split(/(\n|[^\S\n]+)/u).filter(Boolean)) {
        if (word === "\n") { lines.push([]); used = 0; continue; }
        if (runsFor(word, size, bold).reduce((sum, run) => sum + run.width, 0) > width) {
          for (const grapheme of segmenter.segment(word)) append(grapheme.segment);
        } else append(word);
      }
      lines.forEach((runs, lineIndex) => {
        const length = runs.reduce((sum, run) => sum + run.width, 0);
        let left = align === "center" ? (width - length) / 2 : align === "right" ? width - length : 0;
        for (const run of runs) {
          doc.font(run.font).fontSize(size).text(run.value, left, lineIndex * lineHeight, { lineBreak: false });
          left += run.width;
        }
      });
      blocks.set(key, { pageIndex: blocks.size, width, height: lines.length * lineHeight });
    }
    doc.on("end", () => resolve({ bytes: new Uint8Array(Buffer.concat(chunks)), blocks }));
    doc.end();
  });
}
