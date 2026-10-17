import type { NextConfig } from "next";

// next-intl's createNextIntlPlugin only aliases `next-intl/config` to our request config, but it eagerly
// loads a native SWC binary that fails on some Windows setups. We set the same alias directly.
const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (.next/standalone).
  output: "standalone",
  serverExternalPackages: ["postgres"],
  // Payment proofs (images/PDF up to 5 MB) are uploaded through a server action.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  turbopack: {
    resolveAlias: { "next-intl/config": "./src/i18n/request.ts" },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
