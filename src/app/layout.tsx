import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./website-preview.css";
import { themeBootScript } from "@/lib/app-theme";

export const metadata: Metadata = { title: "Finance Billing", description: "Secure finance billing and Excel register", icons: { apple: "/icons/apple-touch-icon.png" }, appleWebApp: { capable: true, title: "Billing", statusBarStyle: "black-translucent" } };
// Phones show the page at its real width instead of a zoomed-out desktop page.
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#17304f" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // data-theme is set before paint from the saved choice (dark by default), so React must not reset it.
  return <html lang="en" data-theme="dark" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootScript }} /></head><body>{children}</body></html>;
}
