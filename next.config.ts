import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.BILLING_NEXT_DIST_DIR || ".next",
  devIndicators: false,
  reactStrictMode: true,
  serverExternalPackages: ["node:sqlite", "pdfkit"],
  outputFileTracingIncludes: { "/api/bills/**": ["./public/fonts/*.ttf", "./public/business-logo.jpg"] },
};
export default nextConfig;
