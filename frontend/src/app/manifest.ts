import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nyay Apex",
    short_name: "Nyay Apex",
    description: "Supreme Court practice suite: matters, hearings, cause lists, research and drafting",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0b2d6b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
