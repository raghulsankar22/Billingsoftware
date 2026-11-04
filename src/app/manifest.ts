import type { MetadataRoute } from "next";

// Lets a phone add billing to its home screen with the shop logo and open it without the browser bar.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finance Billing",
    short_name: "Billing",
    description: "Finance billing on the shop network",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b1220",
    theme_color: "#17304f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
