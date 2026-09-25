import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // PGlite (in-process Postgres) replays every migration per test file; with several database test
    // files running in parallel on a busy machine that can exceed a minute.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
