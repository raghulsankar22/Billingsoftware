import type { Metadata } from "next";
import "./globals.css";
import "./website-preview.css";
import { themeBootScript } from "@/lib/app-theme";

export const metadata: Metadata = { title: "Finance Billing", description: "Secure finance billing and Excel register" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // data-theme is set before paint from the saved choice (dark by default), so React must not reset it.
  return <html lang="en" data-theme="dark" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootScript }} /></head><body>{children}</body></html>;
}
