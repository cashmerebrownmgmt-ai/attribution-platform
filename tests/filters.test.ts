import { describe, expect, it } from "vitest";
import { filterQuery, parseFilters, presetRange } from "@/lib/dashboard/filters";

const TODAY = "2026-09-24";

describe("presetRange", () => {
  it.each([
    ["today", "2026-09-24", "2026-09-24"],
    ["yesterday", "2026-09-23", "2026-09-23"],
    ["7d", "2026-09-18", "2026-09-24"],
    ["30d", "2026-08-26", "2026-09-24"],
    ["mtd", "2026-09-01", "2026-09-24"],
    ["last_month", "2026-08-01", "2026-08-31"],
  ] as const)("%s", (id, from, to) => {
    expect(presetRange(id, TODAY)).toEqual({ from, to });
  });
  it("handles January's last month", () => {
    expect(presetRange("last_month", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("parseFilters", () => {
  it("defaults to last 30 days, last non-direct, all platforms", () => {
    expect(parseFilters({}, TODAY)).toMatchObject({ preset: "30d", model: "last_non_direct", platform: "all", range: { from: "2026-08-26", to: TODAY } });
  });
  it("reads presets, model and platform; ignores junk", () => {
    expect(parseFilters({ range: "yesterday", model: "first_touch", platform: "tiktok" }, TODAY)).toMatchObject({
      preset: "yesterday", model: "first_touch", platform: "tiktok", range: { from: "2026-09-23", to: "2026-09-23" },
    });
    expect(parseFilters({ range: "bogus", model: "x", platform: "myspace" }, TODAY)).toMatchObject({ preset: "30d", model: "last_non_direct", platform: "all" });
  });
  it("accepts a custom range, clamping the future and anything over a year", () => {
    expect(parseFilters({ from: "2026-09-01", to: "2026-12-01" }, TODAY).range).toEqual({ from: "2026-09-01", to: TODAY });
    expect(parseFilters({ from: "2020-01-01", to: "2026-09-24" }, TODAY).range.from).toBe("2025-09-24");
    expect(parseFilters({ from: "2026-09-10", to: "2026-09-01" }, TODAY).preset).toBe("30d"); // reversed → ignored
  });
  it("round-trips through the query string", () => {
    const f = parseFilters({ range: "7d", platform: "meta" }, TODAY);
    expect(filterQuery(f)).toBe("?range=7d&platform=meta");
    expect(filterQuery(parseFilters({}, TODAY))).toBe("");
    expect(filterQuery(parseFilters({ from: "2026-09-01", to: "2026-09-05" }, TODAY))).toBe("?from=2026-09-01&to=2026-09-05");
  });
});

import { inspectHref, parseInspect } from "@/lib/dashboard/inspect";

describe("inspect targets", () => {
  it("parses valid targets and rejects junk", () => {
    expect(parseInspect("platform:google")).toEqual({ level: "platform", key: "google" });
    expect(parseInspect("campaign:meta:mc1001")).toEqual({ level: "campaign", key: "meta:mc1001" });
    expect(parseInspect("ad:tiktok:123")).toEqual({ level: "ad", key: "tiktok:123" });
    for (const bad of ["", "ad", "ad:myspace:1", "platform:meta:1", "campaign:meta", "root:meta:1", "ad:meta:1:2"]) {
      expect(parseInspect(bad)).toBeNull();
    }
  });
  it("builds links that keep filters", () => {
    const f = parseFilters({ range: "7d" }, TODAY);
    expect(inspectHref("/dashboard", f, "ad", "meta:a1")).toBe("/dashboard?range=7d&inspect=ad%3Ameta%3Aa1");
  });
});
