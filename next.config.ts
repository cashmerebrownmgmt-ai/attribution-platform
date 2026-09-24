import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF renderer loads fonts and a layout engine at runtime; keep it out of the server bundle.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
