import { describe, expect, it } from "vitest";
import { combine, goalPushes, isQuiet, morningPush, parsePrefs, problemsToPush, unsent } from "@/lib/goal-alerts";

const prefs = parsePrefs({ spendCap: 150, revenueGoal: 500, lossMinSpend: 50 });
const day = "2026-09-27";
const AFTERNOON = 15;

describe("parsePrefs", () => {
  it("fills defaults and ignores bad values", () => {
    expect(parsePrefs(null)).toEqual({ spendCap: null, revenueGoal: null, lossMinSpend: 50, on: { spendCap: true, loss: true, revenueGoal: true, daily: true } });
    expect(parsePrefs({ spendCap: "abc", on: { loss: false } })).toMatchObject({ spendCap: null, on: { loss: false, daily: true } });
  });
});

describe("goalPushes", () => {
  it("sends nothing on a normal day", () => {
    expect(goalPushes({ day, revenue: 300, spend: 100, orders: 6 }, prefs, "USD", AFTERNOON)).toEqual([]);
  });

  it("flags spend over the cap", () => {
    const [p] = goalPushes({ day, revenue: 400, spend: 160.5, orders: 8 }, prefs, "USD", 10);
    expect(p).toMatchObject({ id: "goal:spend-cap:2026-09-27", title: "Ad spend passed $150 today" });
    expect(p.body).toBe("$161 spent so far, $400 in sales from 8 orders. Profit $240.");
  });

  it("flags a loss only in the afternoon and once spend reaches the minimum", () => {
    expect(goalPushes({ day, revenue: 0, spend: 30, orders: 0 }, prefs, "USD", AFTERNOON)).toEqual([]);
    expect(goalPushes({ day, revenue: 20, spend: 60, orders: 1 }, prefs, "USD", 11)).toEqual([]); // morning: sales usually catch up
    const [p] = goalPushes({ day, revenue: 20, spend: 60, orders: 1 }, prefs, "USD", AFTERNOON);
    expect(p).toMatchObject({ id: "goal:loss:2026-09-27", title: "Losing money today" });
    expect(p.body).toContain("-$40");
  });

  it("celebrates the revenue goal", () => {
    expect(goalPushes({ day, revenue: 520, spend: 120, orders: 12 }, prefs, "USD", AFTERNOON).map((p) => p.id)).toEqual(["goal:revenue:2026-09-27"]);
  });

  it("stays quiet overnight (10 PM to 8 AM)", () => {
    expect([7.9, 22, 23.5, 0].every(isQuiet)).toBe(true);
    expect([8, 12, 21.9].some(isQuiet)).toBe(false);
    expect(goalPushes({ day, revenue: 900, spend: 1000, orders: 1 }, prefs, "USD", 23)).toEqual([]);
  });

  it("respects the on/off switches and missing goals", () => {
    const off = parsePrefs({ spendCap: 150, revenueGoal: 500, on: { spendCap: false, loss: false, revenueGoal: false } });
    expect(goalPushes({ day, revenue: 900, spend: 1000, orders: 1 }, off, "USD", AFTERNOON)).toEqual([]);
    expect(goalPushes({ day, revenue: 900, spend: 200, orders: 1 }, parsePrefs({}), "USD", AFTERNOON)).toEqual([]);
  });
});

describe("problemsToPush", () => {
  it("keeps only things that are broken right now", () => {
    const alerts = [
      { id: "orders-stopped", severity: "critical" as const, title: "No orders in the last 48 hours", detail: "" },
      { id: "health-sync-failing-meta", severity: "critical" as const, title: "Meta sync is failing", detail: "" },
      { id: "health-utm", severity: "critical" as const, title: "Ad UTM tags: needs attention", detail: "" },
      { id: "health-pixel", severity: "critical" as const, title: "Checkout pixel: needs attention", detail: "" },
      { id: "ads-no-sales", severity: "warning" as const, title: "3 ads spent with no sales", detail: "" },
    ];
    expect(problemsToPush(alerts).map((a) => a.id)).toEqual(["orders-stopped", "health-sync-failing-meta"]);
  });
});

describe("morningPush", () => {
  const report = { day: "2026-09-26", summary: ["Saturday: $570 from 15 orders."] };
  const problem = { id: "orders-stopped", severity: "critical" as const, title: "No orders in the last 48 hours", detail: "Usually 12 a day." };

  it("is one notification: the report headline", () => {
    expect(morningPush(report, [], prefs)).toEqual({ id: "daily:2026-09-26", title: "Your daily report is ready", body: "Saturday: $570 from 15 orders.", url: "/dashboard/daily?day=2026-09-26" });
  });

  it("folds a new problem into the same notification", () => {
    const p = morningPush(report, [problem], prefs)!;
    expect(p.title).toBe("Daily report ready · 1 problem ⚠️");
    expect(p.body).toBe("Saturday: $570 from 15 orders. No orders in the last 48 hours");
    expect(p.url).toBe("/dashboard/health");
  });

  it("is silent when turned off or when there's nothing to say", () => {
    expect(morningPush(report, [problem], parsePrefs({ on: { daily: false } }))).toBeNull();
    expect(morningPush(null, [], prefs)).toBeNull();
  });
});

describe("combine and unsent", () => {
  it("sends several goal alerts as one notification", () => {
    const ps = goalPushes({ day, revenue: 520, spend: 200, orders: 12 }, prefs, "USD", AFTERNOON);
    expect(combine(ps)!.title).toBe("Ad spend passed $150 today · Revenue goal hit: $520 today");
    expect(combine([])).toBeNull();
  });

  it("drops what was already sent", () => {
    const ps = goalPushes({ day, revenue: 520, spend: 200, orders: 12 }, prefs, "USD", AFTERNOON);
    expect(unsent(ps, new Set(["goal:spend-cap:2026-09-27"])).map((p) => p.id)).toEqual(["goal:revenue:2026-09-27"]);
  });
});
