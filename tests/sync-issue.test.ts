import { describe, expect, it } from "vitest";
import { syncIssueCheck } from "@/lib/metrics/health";

describe("failing ad-platform sync", () => {
  it("explains a blocked Meta token and how to fix it", () => {
    const c = syncIssueCheck({ platform: "meta", message: "API access blocked.", lastSyncedAt: "2026-09-26T16:45:00Z" }, Date.parse("2026-09-26T18:45:00Z"));
    expect(c).toMatchObject({ name: "Meta sync is failing", level: "bad" });
    expect(c.detail).toContain('Meta says: "API access blocked."');
    expect(c.detail).toContain("2 h ago");
    expect(c.fix).toMatch(/new token/);
  });
  it("suggests a retry for other errors", () => {
    expect(syncIssueCheck({ platform: "meta", message: "Please reduce the amount of data", lastSyncedAt: null }, 0).fix).toMatch(/Refresh/);
  });
});

import { kpis } from "@/lib/metrics/compute";
import { generateDemo } from "@/lib/demo/generate";

describe("overview profit", () => {
  it("is revenue minus ad spend", () => {
    const d = generateDemo({ endDay: "2026-09-20" });
    const k = kpis(d, { model: "last_non_direct", platform: "all" }, { from: "2026-09-01", to: "2026-09-20" });
    expect(k.profit).toBeCloseTo(k.revenue - k.spend, 2);
  });
});
