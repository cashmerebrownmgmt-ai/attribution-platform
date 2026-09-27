import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF renderer loads fonts and a layout engine at runtime; keep it out of the server bundle.
  serverExternalPackages: ["@react-pdf/renderer"],
  async headers() {
    return [
      {
        // The service worker must never be served from a cache, or phones keep running an old one.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
