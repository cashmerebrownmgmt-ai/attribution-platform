import { describe, expect, it } from "vitest";
import { generateDemo } from "@/lib/demo/generate";
import { compareKpis, performance } from "@/lib/metrics/compute";

const END = "2026-09-24";
const demo = generateDemo({ endDay: END });
const f = { range: { from: "2026-08-26", to: END }, model: "last_non_direct" as const, platform: "all" as const };

describe("generateDemo", () => {
  it("is deterministic", () => {
    const again = generateDemo({ endDay: END });
    expect(again.orders.length).toBe(demo.orders.length);
    expect(again.orders[500]).toEqual(demo.orders[500]);
    expect(again.insights[300]).toEqual(demo.insights[300]);
  });

  it("covers every platform and keeps entity references consistent", () => {
    expect(new Set(demo.campaigns.map((c) => c.platform))).toEqual(new Set(["meta", "google", "tiktok"]));
    const ads = new Set(demo.ads.map((a) => `${a.platform}:${a.id}`));
    const groups = new Set(demo.adGroups.map((g) => `${g.platform}:${g.id}`));
    for (const i of demo.insights) expect(ads.has(`${i.platform}:${i.adId}`)).toBe(true);
    for (const a of demo.ads) expect(groups.has(`${a.platform}:${a.adGroupId}`)).toBe(true);
    for (const o of demo.orders) {
      const t = o.touches.last_non_direct;
      if (t.adId) expect(ads.has(`${t.platform}:${t.adId}`)).toBe(true);
    }
  });

  it("has no activity after the end day or before an ad launched", () => {
    expect(demo.orders.every((o) => o.createdAt.slice(0, 10) <= END)).toBe(true);
    const launch = new Map(demo.ads.map((a) => [a.id, a.launchedAt!.slice(0, 10)]));
    expect(demo.insights.every((i) => i.date >= launch.get(i.adId)!)).toBe(true);
  });

  it("tells a realistic story: profitable overall, with clear winners and losers", () => {
    const k = compareKpis(demo, f).current;
    expect(k.roas).toBeGreaterThan(1.5);
    expect(k.platformRoas!).toBeGreaterThan(k.roas!); // platforms over-report
    const campaigns = performance(demo, f, "campaign");
    expect(Math.max(...campaigns.map((c) => c.roas ?? 0))).toBeGreaterThan(5);
    expect(Math.min(...campaigns.map((c) => c.roas ?? 99))).toBeLessThan(1);
  });

  it("includes an ad missing UTMs for the health checks", () => {
    expect(demo.ads.some((a) => a.landingUrl && !a.landingUrl.includes("utm_content="))).toBe(true);
  });
});
