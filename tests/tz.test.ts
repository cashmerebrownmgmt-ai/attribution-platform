import { describe, expect, it } from "vitest";
import { dayOf, kpis } from "@/lib/metrics/compute";
import type { DashboardData, OrderFact, Touch } from "@/lib/metrics/types";
import { storeDay } from "@/lib/tz";

describe("store time zone (America/New_York)", () => {
  it("puts evening orders on the Eastern day, like Shopify", () => {
    expect(storeDay("2026-09-25T00:29:00Z")).toBe("2026-09-24"); // 8:29pm EDT
    expect(storeDay("2026-09-25T03:59:59Z")).toBe("2026-09-24");
    expect(storeDay("2026-09-25T04:00:00Z")).toBe("2026-09-25"); // midnight EDT
    expect(storeDay("2026-12-15T04:30:00Z")).toBe("2026-12-14"); // 11:30pm EST (UTC-5)
    expect(storeDay("2026-12-15T05:00:00Z")).toBe("2026-12-15");
  });
  it("handles the daylight-saving switches", () => {
    expect(storeDay("2026-03-08T06:59:00Z")).toBe("2026-03-08"); // 1:59am EST → clocks jump to 3am
    expect(storeDay("2026-11-01T04:30:00Z")).toBe("2026-11-01"); // 12:30am EDT
    expect(storeDay("2026-11-02T04:30:00Z")).toBe("2026-11-01"); // 11:30pm EST
  });
  it("accepts offsets other than Z and passes plain dates through", () => {
    expect(storeDay("2026-09-25T00:29:00+00:00")).toBe("2026-09-24");
    expect(storeDay("2026-09-24T21:00:00-04:00")).toBe("2026-09-24");
    expect(dayOf("2026-09-24")).toBe("2026-09-24");
  });
});

describe("Today's revenue", () => {
  const direct: Touch = { channel: "direct", platform: null, campaignId: null, adId: null };
  let n = 0;
  const order = (createdAt: string, revenue: number): OrderFact => ({
    id: `o${++n}`,
    name: `#${n}`,
    createdAt,
    revenue,
    isNew: true,
    cancelled: false,
    stitchMethod: "none",
    touches: { first_touch: direct, last_touch: direct, last_non_direct: direct },
    path: [],
    daysToPurchase: null,
    customerKey: null,
    items: [],
  });
  it("counts only orders placed after midnight Eastern (the $115 vs $22.50 case)", () => {
    const data = {
      orders: [
        order("2026-09-25T00:29:00Z", 7.5),
        order("2026-09-25T02:11:00Z", 69.99),
        order("2026-09-25T02:19:00Z", 7.5),
        order("2026-09-25T02:43:00Z", 7.5),
        order("2026-09-25T04:24:00Z", 0),
        order("2026-09-25T07:14:00Z", 22.5),
      ],
      insights: [],
    } as unknown as DashboardData;
    const k = kpis(data, { model: "last_non_direct", platform: "all" }, { from: "2026-09-25", to: "2026-09-25" });
    expect(k.revenue).toBeCloseTo(22.5);
    expect(k.orders).toBe(2);
  });
});
