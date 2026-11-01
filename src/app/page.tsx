import { BillingApp } from "@/components/billing-app";
import { LanguageProvider } from "@/components/language-provider";
import { isTamilPreviewStorage } from "@/lib/tamil-preview-storage";

export const dynamic = "force-dynamic";

export default function Home() { return <LanguageProvider demo={isTamilPreviewStorage()}><BillingApp /></LanguageProvider>; }
