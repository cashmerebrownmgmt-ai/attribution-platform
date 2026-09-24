import { describe, expect, it } from "vitest";
import type { PerfRow } from "@/lib/metrics/compute";
import { adSignal } from "@/lib/metrics/signals";

const settings = { targetRoas: 2.5, targetCpa: 30, breakevenRoas: 1.8 };
function row(o: Partial<PerfRow>): PerfRow {
  const r = { key: "meta:a", platform: "meta" as const, name: "Ad", status: "active", spend: 1000, impressions: 100000, clicks: 1000, orders: 20, revenue: 2500, newCustomers: 10, platformRevenue: 3000, ...o };
  return { ...r, ctr: r.clicks / r.impressions, cpm: 10, cpc: 1, roas: r.spend ? r.revenue / r.spend : null, cpa: r.orders ? r.spend / r.orders : null, platformRoas: 3, ...o };
}
const sig = (o: Partial<PerfRow>, ctrDecay: number | null = 0, ageDays: number | null = 60) => adSignal({ row: row(o), ctrDecay, ageDays, settings });

describe("adSignal", () => {
  it("waits on new or low-spend ads", () => {
    expect(sig({}, 0, 3).verdict).toBe("learning");
    expect(sig({ spend: 50, revenue: 0, orders: 0 }).verdict).toBe("learning");
  });
  it("pauses ads spending with no sales or far below break-even", () => {
    expect(sig({ spend: 500, revenue: 0, orders: 0 }).verdict).toBe("pause");
    expect(sig({ spend: 1000, revenue: 800 }).verdict).toBe("pause"); // 0.8 < 0.9
  });
  it("flags fatigue before anything else once past pause checks", () => {
    const s = sig({ revenue: 4000 }, -0.4);
    expect(s.verdict).toBe("refresh");
    expect(s.reasons[0]).toContain("40%");
  });
  it("scales winners only while CTR holds", () => {
    expect(sig({ revenue: 4000 }, -0.05).verdict).toBe("scale");
    expect(sig({ revenue: 4000 }, 0).reasons[1]).toBe("Click-through rate is steady");
    const tiring = sig({ revenue: 4000 }, -0.21);
    expect(tiring.verdict).toBe("keep");
    expect(tiring.headline).toContain("tire");
  });
  it("watches ads under target or break-even, keeps ads on target", () => {
    expect(sig({ revenue: 1500 }).verdict).toBe("watch"); // 1.5 < break-even
    expect(sig({ revenue: 2200 }).verdict).toBe("watch"); // between
    expect(sig({ revenue: 2600 }).verdict).toBe("keep");
  });
});
