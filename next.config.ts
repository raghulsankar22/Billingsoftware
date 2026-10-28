import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["node:sqlite"],
  outputFileTracingIncludes: { "/api/bills/**": ["./public/bill-conditions.jpeg"] },
};
export default nextConfig;
