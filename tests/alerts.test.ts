import { describe, expect, it } from "vitest";
import { alertEmail, alertsFor, dueAlerts, type Alert } from "@/lib/alerts";
import type { DashboardData, HealthData, OrderFact, Touch } from "@/lib/metrics/types";

const now = Date.parse("2026-09-25T12:00:00Z");
const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();
const direct: Touch = { channel: "direct", platform: null, campaignId: null, adId: null };
const metaAd = (adId: string): Touch => ({ channel: "paid_social", platform: "meta", campaignId: "c1", adId });

let n = 0;
const order = (hoursAgo: number, revenue = 50, t: Touch = direct): OrderFact => ({
  id: `o${++n}`,
  name: `#${n}`,
  createdAt: iso(hoursAgo),
  revenue,
  isNew: true,
  cancelled: false,
  stitchMethod: "cart_attribute",
  touches: { first_touch: t, last_touch: t, last_non_direct: t },
  path: [],
  daysToPurchase: 0,
  customerKey: null,
  items: [],
});

const healthy: HealthData = {
  eventsByHour: [],
  lastEventAt: iso(0.1),
  webhooks24h: { total: 5, failed: 0 },
  lastWebhookAt: iso(1),
  stitch7d: { cart_attribute: 10 },
  pixelCheckouts7d: 10,
  orders7d: 10,
};

function data(o: Partial<DashboardData> = {}): DashboardData {
  return {
    mode: "live",
    generatedAt: new Date(now).toISOString(),
    settings: { currency: "USD", targetRoas: 2, targetCpa: 25, breakevenRoas: 1.5, lookbackDays: 30, businessName: null },
    orders: [order(3)],
    campaigns: [],
    adGroups: [],
    ads: [],
    insights: [{ platform: "meta", adId: "none", date: "2026-09-24", spend: 0, impressions: 0, clicks: 0, platformConversions: 0, platformRevenue: 0 }],
    health: healthy,
    ...o,
  };
}

const ids = (d: DashboardData) => alertsFor(d, now).map((a) => a.id);

describe("alertsFor", () => {
  it("is quiet when everything is healthy", () => {
    expect(ids(data())).toEqual([]);
  });

  it("turns failing health checks into critical alerts, but not warnings", () => {
    const d = data({ health: { ...healthy, lastEventAt: iso(5), webhooks24h: { total: 4, failed: 2 } } });
    const a = alertsFor(d, now);
    expect(a.map((x) => x.id)).toEqual(["health-tracker", "health-webhooks"]);
    expect(a.every((x) => x.severity === "critical")).toBe(true);
    expect(ids(data({ health: { ...healthy, lastEventAt: iso(1) } }))).toEqual([]); // 1 h quiet is only a warning
  });

  it("flags orders stopping only for a store that normally sells daily", () => {
    const busy = Array.from({ length: 28 * 4 }, (_, i) => order(60 + i * 6));
    expect(ids(data({ orders: busy }))).toEqual(["orders-stopped"]);
    const slow = Array.from({ length: 20 }, (_, i) => order(60 + i * 30));
    expect(ids(data({ orders: slow }))).toEqual([]);
  });

  it("flags ads spending past 2× target CPA with no sales in 3 full days", () => {
    const ads = ["a1", "a2", "a3"].map((id) => ({ platform: "meta" as const, id, adGroupId: "g", campaignId: "c1", name: id.toUpperCase(), status: "active", format: "video", headline: null, body: null, thumbnailUrl: null, videoUrl: null, cta: null, landingUrl: null, launchedAt: null }));
    const ins = (adId: string, date: string, spend: number) => ({ platform: "meta" as const, adId, date, spend, impressions: 1000, clicks: 10, platformConversions: 0, platformRevenue: 0 });
    const d = data({
      ads,
      insights: [ins("a1", "2026-09-22", 40), ins("a1", "2026-09-24", 30), ins("a2", "2026-09-23", 80), ins("a3", "2026-09-24", 20), ins("a1", "2026-09-25", 500)],
      orders: [order(3), order(30, 50, metaAd("a2"))],
    });
    const a = alertsFor(d, now).find((x) => x.id === "ads-no-sales")!;
    expect(a.title).toBe("1 ad spent $70 in 3 days with no sales");
    expect(a.detail).toContain("A1 (meta): $70");
  });

  it("warns when paid return is below break-even with meaningful spend", () => {
    const ins = (date: string, spend: number) => ({ platform: "meta" as const, adId: "x", date, spend, impressions: 1, clicks: 1, platformConversions: 0, platformRevenue: 0 });
    const low = data({ insights: [ins("2026-09-20", 100), ins("2026-09-22", 100)], orders: [order(3), order(50, 250, metaAd("x"))] });
    expect(ids(low)).toContain("roas-below-breakeven");
    const ok = data({ insights: [ins("2026-09-20", 100), ins("2026-09-22", 100)], orders: [order(3), order(50, 350, metaAd("x"))] });
    expect(ids(ok)).not.toContain("roas-below-breakeven");
  });
});

describe("dueAlerts", () => {
  const a: Alert[] = [
    { id: "x", severity: "critical", title: "X", detail: "" },
    { id: "y", severity: "warning", title: "Y", detail: "" },
    { id: "z", severity: "warning", title: "Z", detail: "" },
  ];
  it("sends new alerts and daily reminders, not repeats within a day", () => {
    const due = dueAlerts(a, [{ id: "x", last_sent_at: iso(2) }, { id: "y", last_sent_at: iso(25) }], now);
    expect(due.map((d) => d.id)).toEqual(["y", "z"]);
  });
});

describe("alertEmail", () => {
  it("leads with critical alerts and escapes content", () => {
    const e = alertEmail(
      [
        { id: "w", severity: "warning", title: "Ad <b>", detail: "d & e" },
        { id: "c", severity: "critical", title: "Tracking", detail: "stopped", fix: "check" },
      ],
      "https://example.com/dashboard",
    );
    expect(e.subject).toBe("⚠ 1 critical alert: Tracking");
    expect(e.html.indexOf("Tracking")).toBeLessThan(e.html.indexOf("Ad &lt;b&gt;"));
    expect(e.html).toContain("d &amp; e");
    expect(e.html).not.toContain("<b>Ad <b>");
    expect(e.text).toContain("[CRITICAL] Tracking");
  });
});

describe("isCronAuthorized", () => {
  it("accepts only the exact bearer secret, and nothing without a secret", async () => {
    const { isCronAuthorized } = await import("@/lib/cron-auth");
    expect(isCronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(isCronAuthorized("Bearer s3creT", "s3cret")).toBe(false);
    expect(isCronAuthorized("s3cret", "s3cret")).toBe(false);
    expect(isCronAuthorized(null, "s3cret")).toBe(false);
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
  });
});
