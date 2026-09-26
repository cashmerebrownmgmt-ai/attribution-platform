import { buildSync } from "esbuild";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("bundle", () => {
  it("builds to under 5 KB minified", () => {
    const out = buildSync({
      entryPoints: [join(__dirname, "..", "tracker", "index.ts")],
      bundle: true,
      minify: true,
      format: "iife",
      target: "es2018",
      write: false,
    });
    expect(out.outputFiles[0].contents.byteLength).toBeLessThan(5 * 1024);
  });
});

describe("landing-page bundle", () => {
  it("builds to under 5 KB minified", () => {
    const out = buildSync({ entryPoints: [join(__dirname, "..", "tracker", "landing.ts")], bundle: true, minify: true, format: "iife", target: "es2018", write: false });
    expect(out.outputFiles[0].contents.byteLength).toBeLessThan(5 * 1024);
  });
});
