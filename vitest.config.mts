import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // PGlite (in-process Postgres) takes several seconds to start when test files run in parallel.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
