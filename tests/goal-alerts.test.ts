import { describe, expect, it } from "vitest";
import { goalPushes, morningPushes, parsePrefs, unsent } from "@/lib/goal-alerts";

const prefs = parsePrefs({ spendCap: 150, revenueGoal: 500, lossMinSpend: 50 });
const day = "2026-09-27";

describe("parsePrefs", () => {
  it("fills defaults and ignores bad values", () => {
    expect(parsePrefs(null)).toEqual({ spendCap: null, revenueGoal: null, lossMinSpend: 50, on: { spendCap: true, loss: true, revenueGoal: true, daily: true } });
    expect(parsePrefs({ spendCap: "abc", on: { loss: false } })).toMatchObject({ spendCap: null, on: { loss: false, daily: true } });
  });
});

describe("goalPushes", () => {
  it("sends nothing on a normal day", () => {
    expect(goalPushes({ day, revenue: 300, spend: 100, orders: 6 }, prefs, "USD")).toEqual([]);
  });

  it("flags spend over the cap", () => {
    const [p] = goalPushes({ day, revenue: 400, spend: 160.5, orders: 8 }, prefs, "USD");
    expect(p).toMatchObject({ id: "goal:spend-cap:2026-09-27", title: "Ad spend passed $150 today" });
    expect(p.body).toBe("$161 spent so far, $400 in sales from 8 orders. Profit $240.");
  });

  it("flags a loss only once spend reaches the minimum", () => {
    expect(goalPushes({ day, revenue: 0, spend: 30, orders: 0 }, prefs, "USD")).toEqual([]);
    const [p] = goalPushes({ day, revenue: 20, spend: 60, orders: 1 }, prefs, "USD");
    expect(p).toMatchObject({ id: "goal:loss:2026-09-27", title: "Losing money today" });
    expect(p.body).toContain("-$40");
  });

  it("celebrates the revenue goal", () => {
    const ps = goalPushes({ day, revenue: 520, spend: 120, orders: 12 }, prefs, "USD");
    expect(ps.map((p) => p.id)).toEqual(["goal:revenue:2026-09-27"]);
  });

  it("respects the on/off switches and missing goals", () => {
    const off = parsePrefs({ spendCap: 150, revenueGoal: 500, on: { spendCap: false, loss: false, revenueGoal: false } });
    expect(goalPushes({ day, revenue: 900, spend: 1000, orders: 1 }, off, "USD")).toEqual([]);
    expect(goalPushes({ day, revenue: 900, spend: 200, orders: 1 }, parsePrefs({}), "USD")).toEqual([]);
  });
});

describe("morningPushes", () => {
  const alerts = [
    { id: "orders-stopped", severity: "critical" as const, title: "No orders in 12 hours", detail: "Last order at 2:00 AM." },
    { id: "ads-no-sales", severity: "warning" as const, title: "3 ads spent with no sales", detail: "…" },
  ];
  it("sends the report headline and critical problems", () => {
    const ps = morningPushes({ day: "2026-09-26", summary: ["Saturday: $570 from 15 orders."] }, alerts, prefs, day);
    expect(ps.map((p) => p.id)).toEqual(["daily:2026-09-26", "push:orders-stopped:2026-09-27"]);
    expect(ps[0]).toMatchObject({ body: "Saturday: $570 from 15 orders.", url: "/dashboard/daily?day=2026-09-26" });
  });
  it("is silent when turned off", () => {
    expect(morningPushes(null, alerts, parsePrefs({ on: { daily: false } }), day)).toEqual([]);
  });
});

describe("unsent", () => {
  it("drops what was already sent", () => {
    const ps = goalPushes({ day, revenue: 520, spend: 200, orders: 12 }, prefs, "USD");
    expect(unsent(ps, new Set(["goal:spend-cap:2026-09-27"])).map((p) => p.id)).toEqual(["goal:revenue:2026-09-27"]);
  });
});
