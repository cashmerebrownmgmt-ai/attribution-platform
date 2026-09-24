import { describe, expect, it } from "vitest";
import { generateDemo } from "@/lib/demo/generate";
import { breakdown, decompose, fitLine, median, type Totals } from "@/lib/metrics/drivers";

const t = (o: Partial<Totals>): Totals => ({ spend: 1000, impressions: 100_000, clicks: 1000, orders: 20, revenue: 2000, newCustomers: 10, platformRevenue: 2500, ...o });

describe("decompose", () => {
  it("splits a ROAS change into factor impacts that add up exactly", () => {
    const prev = t({});
    const cur = t({ clicks: 800, orders: 20, revenue: 2400, spend: 1100, impressions: 100_000 });
    const d = decompose(cur, prev)!;
    const total = d.reduce((s, x) => s + x.roasImpact, 0);
    expect(total).toBeCloseTo(2400 / 1100 - 2, 10);
    const by = Object.fromEntries(d.map((x) => [x.factor, x]));
    expect(by.ctr.effect).toBe("hurting"); // CTR 1% → 0.8%
    expect(by.cvr.effect).toBe("helping"); // CVR 2% → 2.5%
    expect(by.aov.effect).toBe("helping"); // AOV 100 → 120
    expect(by.cpm.effect).toBe("hurting"); // CPM 10 → 11
  });

  it("isolates a single factor", () => {
    const d = decompose(t({ revenue: 3000 }), t({}))!; // only AOV changed
    const by = Object.fromEntries(d.map((x) => [x.factor, x]));
    expect(by.aov.roasImpact).toBeCloseTo(1, 10);
    expect(by.ctr.roasImpact).toBeCloseTo(0, 10);
    expect(by.ctr.effect).toBe("neutral");
  });

  it("returns null when a period has no orders or spend", () => {
    expect(decompose(t({ orders: 0, revenue: 0 }), t({}))).toBeNull();
    expect(decompose(t({}), t({ spend: 0 }))).toBeNull();
  });
});

describe("fitLine and median", () => {
  it("recovers a known line", () => {
    const xs = [1, 2, 3, 4, 5];
    const f = fitLine(xs, xs.map((x) => 2 + 0.7 * x))!;
    expect(f.b).toBeCloseTo(0.7, 10);
    expect(f.a).toBeCloseTo(2, 10);
    expect(f.r2).toBeCloseTo(1, 10);
    expect(fitLine([1, 1, 1], [1, 2, 3])).toBeNull();
  });
  it("computes medians", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("breakdown on demo data", () => {
  const demo = generateDemo({ endDay: "2026-09-24" });
  const f = { range: { from: "2026-08-26", to: "2026-09-24" }, model: "last_non_direct" as const, platform: "all" as const };

  it("explains a campaign with findings, benchmarks and a spend model", () => {
    const campaign = demo.campaigns.find((c) => c.name.startsWith("Prospecting"))!;
    const b = breakdown(demo, f, "campaign", `${campaign.platform}:${campaign.id}`);
    expect(b.current.spend).toBeGreaterThan(0);
    expect(b.findings.length).toBeGreaterThan(1);
    expect(b.benchmarks.find((x) => x.factor === "roas")?.peers).toBeGreaterThan(0);
    expect(b.model).not.toBeNull();
    expect(b.model!.elasticity).toBeLessThanOrEqual(1);
  });

  it("recovers diminishing returns on a stable campaign", () => {
    // Demo revenue grows with spend^0.7; Performance Max runs all window with no launches.
    const pmax = demo.campaigns.find((c) => c.name.startsWith("Performance Max"))!;
    const m = breakdown(demo, f, "campaign", `${pmax.platform}:${pmax.id}`).model!;
    expect(m.elasticity).toBeGreaterThan(0.45);
    expect(m.elasticity).toBeLessThan(0.95);
    expect(m.confidence).not.toBe("low");
    expect(m.marginalRoas!).toBeLessThan(m.avgRoas!);
  });

  it("flags a fatiguing creative as hurting", () => {
    const ad = demo.ads.find((a) => a.name.startsWith("Spark – @dailydrip"))!;
    const b = breakdown(demo, f, "ad", `${ad.platform}:${ad.id}`);
    expect(b.findings.some((x) => x.effect === "hurting" && /fatigue/i.test(x.title))).toBe(true);
  });

  it("works for a whole platform", () => {
    const b = breakdown(demo, f, "platform", "google");
    expect(b.roas.current).toBeGreaterThan(1);
    expect(b.findings[0].title).toMatch(/ROAS/);
  });
});
