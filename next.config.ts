import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["node:sqlite", "pdfkit"],
  outputFileTracingIncludes: { "/api/bills/**": ["./public/fonts/*.ttf", "./public/business-logo.jpg"] },
};
export default nextConfig;
