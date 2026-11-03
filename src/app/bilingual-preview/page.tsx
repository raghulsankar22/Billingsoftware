import { notFound } from "next/navigation";
import { BilingualPrintDemo } from "@/components/bilingual-print-demo";
import { isTamilPreviewStorage } from "@/lib/tamil-preview-storage";

export const dynamic = "force-dynamic";

export default function BilingualPreview() {
  if (!isTamilPreviewStorage()) notFound();
  return <BilingualPrintDemo />;
}
