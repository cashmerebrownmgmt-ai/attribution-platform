import { describe, expect, it } from "vitest";
import { daily, kpis, spendByDay } from "@/lib/metrics/compute";
import { healthChecks } from "@/lib/metrics/health";
import type { DashboardData, Insight } from "@/lib/metrics/types";

const ins = (adId: string, date: string, spend: number, platform: Insight["platform"] = "meta"): Insight => ({ platform, adId, date, spend, impressions: 100, clicks: 1, platformConversions: null, platformRevenue: null });

function data(o: Partial<DashboardData>): DashboardData {
  return {
    mode: "live",
    generatedAt: "2026-09-25T20:00:00Z",
    settings: { currency: "USD", targetRoas: 2, targetCpa: 25, breakevenRoas: 1.5, lookbackDays: 30, businessName: null },
    orders: [],
    campaigns: [],
    adGroups: [],
    ads: [],
    insights: [],
    health: { eventsByHour: [], lastEventAt: "2026-09-25T19:59:00Z", webhooks24h: { total: 1, failed: 0 }, lastWebhookAt: "2026-09-25T19:00:00Z", stitch7d: {}, pixelCheckouts7d: 0, orders7d: 0 },
    ...o,
  };
}

const f = { model: "last_non_direct" as const, platform: "all" as const };
const r = { from: "2026-09-24", to: "2026-09-25" };

describe("ad spend totals", () => {
  const D = data({
    insights: [ins("a", "2026-09-24", 40), ins("b", "2026-09-24", 50), ins("a", "2026-09-25", 30), ins("g", "2026-09-25", 12, "google")],
    // Meta's own account total on the 24th includes $10 from an ad the API no longer lists.
    adSync: [{ platform: "meta", syncedAt: "2026-09-25T19:50:00Z", accountDaily: [{ date: "2026-09-24", spend: 100 }] }],
  });

  it("uses the account total where known, the ad-level sum elsewhere, per platform", () => {
    expect(Object.fromEntries(spendByDay(D, r))).toEqual({ "2026-09-24": 100, "2026-09-25": 42 });
    expect(Object.fromEntries(spendByDay(D, r, "google"))).toEqual({ "2026-09-25": 12 });
    expect(kpis(D, f, r).spend).toBe(142);
    expect(daily(D, { ...f, range: r }).map((d) => d.spend)).toEqual([100, 42]);
  });

  it("flags days where the ads don't add up to the account, and confirms when they do", () => {
    const off = healthChecks(D).find((c) => c.id === "match-meta")!;
    expect(off.level).toBe("warn");
    expect(off.detail).toContain("2026-09-24 dashboard $90.00 vs Ads Manager $100.00");
    const ok = healthChecks(data({ insights: [ins("a", "2026-09-24", 40)], adSync: [{ platform: "meta", syncedAt: "2026-09-25T19:50:00Z", accountDaily: [{ date: "2026-09-24", spend: 40 }] }] })).find((c) => c.id === "match-meta")!;
    expect(ok.level).toBe("ok");
    expect(ok.detail).toBe("Last 7 days match to the cent ($40.00) · updated 10 min ago.");
  });
});
