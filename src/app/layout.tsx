import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Finance Billing", description: "Secure finance billing and Excel register" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
