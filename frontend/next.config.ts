import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production server cannot run the Next build tools (old glibc): built elsewhere, shipped as a standalone bundle
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Every page sits behind the client-side login guard (AppShell), so pages are never
    // rendered on the server and automatic instant-navigation validation can't inspect them.
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
