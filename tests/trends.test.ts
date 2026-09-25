import { describe, expect, it } from "vitest";
import { cleanTitle, decodeSearch, falling, handleLabel, lowCartProducts, movers, overallScale, rising, searchMatches, totals, trendTips, type PageStat } from "@/lib/trends";

const m = <T,>(o: Record<string, T>) => new Map(Object.entries(o));

describe("decodeSearch", () => {
  it("decodes and normalizes", () => {
    expect(decodeSearch("Trap+Drums")).toBe("trap drums");
    expect(decodeSearch("jersey%20club%20%20kit")).toBe("jersey club kit");
    expect(decodeSearch("%E0%A4%A")).toBe("%e0%a4%a"); // malformed stays readable
  });
  it("drops empty terms and anything that looks like an email or phone number", () => {
    expect(decodeSearch("+")).toBeNull();
    expect(decodeSearch("me%40mail.com")).toBeNull();
    expect(decodeSearch("(555) 123-4567")).toBeNull();
    expect(decodeSearch("808")).toBe("808");
  });
});

describe("labels", () => {
  it("strips the store name from page titles", () => {
    expect(cleanTitle("808 Essentials – Cashmere Brown")).toBe("808 Essentials");
    expect(cleanTitle("Drum Kit | Store")).toBe("Drum Kit");
    expect(cleanTitle("Solo")).toBe("Solo");
    expect(cleanTitle(null)).toBeNull();
  });
  it("turns handles into words", () => {
    expect(handleLabel("the-soul-reserve-vol-2")).toBe("The Soul Reserve Vol 2");
  });
});

describe("totals", () => {
  const stats: PageStat[] = [
    { day: "2026-09-01", kind: "search", key: "trap+drums", title: null, views: 2, sessions: 2, carts: 1 },
    { day: "2026-09-02", kind: "search", key: "trap%20drums", title: null, views: 1, sessions: 1, carts: 0 },
    { day: "2026-09-02", kind: "search", key: "a%40b.co", title: null, views: 5, sessions: 5, carts: 0 },
    { day: "2026-09-02", kind: "product", key: "808-essentials", title: "808 Essentials – Store", views: 4, sessions: 3, carts: 1 },
    { day: "2026-08-20", kind: "product", key: "808-essentials", title: null, views: 9, sessions: 9, carts: 9 },
  ];
  it("sums in range, merges search terms that decode the same, and drops personal data", () => {
    const s = totals(stats, "search", { from: "2026-09-01", to: "2026-09-02" });
    expect([...s.values()]).toEqual([{ key: "trap drums", label: "trap drums", views: 3, sessions: 3, carts: 1 }]);
    const p = totals(stats, "product", { from: "2026-09-01", to: "2026-09-02" });
    expect(p.get("808-essentials")).toMatchObject({ label: "808 Essentials", sessions: 3 });
  });
});

describe("movers", () => {
  it("classifies by a Poisson z-score and ignores tiny numbers", () => {
    const ms = movers(m({ up: 60, flat: 52, down: 10, fresh: 15, tiny: 4 }), m({ up: 25, flat: 50, down: 40, tiny: 0 }));
    const by = Object.fromEntries(ms.map((x) => [x.key, x.status]));
    expect(by).toEqual({ up: "rising", flat: "steady", down: "falling", fresh: "new" });
    expect(ms.find((x) => x.key === "up")?.change).toBeCloseTo(1.4);
    expect(ms.find((x) => x.key === "fresh")?.change).toBeNull();
    expect(rising(ms).map((x) => x.key).sort()).toEqual(["fresh", "up"]);
    expect(falling(ms).map((x) => x.key)).toEqual(["down"]);
  });
});

describe("searchMatches", () => {
  const catalog = ["808 Essentials", "Heat Drum Kit", "the-soul-reserve-vol-2"];
  it("matches when every meaningful word appears in a product name", () => {
    expect(searchMatches("808", catalog)).toBe(true);
    expect(searchMatches("drum kit", catalog)).toBe(true);
    expect(searchMatches("soul", catalog)).toBe(true);
    expect(searchMatches("jersey club", catalog)).toBe(false);
    expect(searchMatches("drill drums", catalog)).toBe(false);
    expect(searchMatches("a", catalog)).toBe(true);
  });
});

describe("lowCartProducts", () => {
  it("flags product pages whose add-to-cart rate is well below the rest", () => {
    const rows = lowCartProducts([
      { key: "a", label: "A", views: 0, sessions: 200, carts: 10 },
      { key: "b", label: "B", views: 0, sessions: 300, carts: 60 },
      { key: "c", label: "C", views: 0, sessions: 300, carts: 57 },
      { key: "d", label: "D", views: 0, sessions: 20, carts: 0 },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["a"]);
    expect(rows[0].cartRate).toBeCloseTo(0.05);
  });
});

describe("trendTips", () => {
  it("turns movers into ranked, specific actions", () => {
    const products = movers(m({ "late-night": 120, vocal: 20 }), m({ "late-night": 50, vocal: 60 }), m({ "late-night": "Late Night Melody Loops", vocal: "Vocal Chops" }));
    const searches = movers(m({ "jersey club": 40, "808": 30 }), m({ "jersey club": 8, "808": 30 }));
    const tips = trendTips({ products, searches, unmatched: new Set(["jersey club"]), lowCart: [], sources: [], days: 7, conversionRate: 0.03 });
    expect(tips.map((t) => t.id).sort()).toEqual(["trend-fading-vocal", "trend-product-late-night", "trend-search-gap-jersey club"]);
    expect(tips.find((t) => t.id.startsWith("trend-search"))?.title).toContain('"jersey club"');
    expect(tips[0].impact).toBeGreaterThanOrEqual(tips[1].impact);
  });
  it("is empty when nothing moves", () => {
    expect(trendTips({ products: [], searches: [], unmatched: new Set(), lowCart: [], sources: [], days: 7, conversionRate: 0.02 })).toEqual([]);
  });
});

describe("movers against the overall trend", () => {
  it("doesn't call everything rising when all traffic grew", () => {
    const cur = m({ a: 140, b: 140, c: 300 });
    const prev = m({ a: 100, b: 100, c: 100 });
    const ms = movers(cur, prev, new Map(), 10, overallScale(cur, prev));
    const by = Object.fromEntries(ms.map((x) => [x.key, x.status]));
    expect(by).toEqual({ a: "falling", b: "falling", c: "rising" });
    expect(movers(m({ a: 140, b: 140 }), m({ a: 100, b: 100 }), new Map(), 10, 1.4).every((x) => x.status === "steady")).toBe(true);
  });
  it("uses no scaling without a baseline", () => {
    expect(overallScale(m({ a: 5 }), new Map())).toBe(1);
  });
});
