import { describe, expect, it } from "vitest";
import { behaviorTips, significant } from "@/lib/behavior-insights";
import { demoSessions } from "@/lib/demo/sessions";
import { sessionsIn, type SessionFact } from "@/lib/sessions";

let n = 0;
function s(o: Partial<SessionFact> = {}): SessionFact {
  return {
    session_id: `s${++n}`, visitor_id: `v${n}`, started_at: "2026-09-20T10:00:00Z", ended_at: "2026-09-20T10:02:00Z", pageviews: 3,
    landing_path: "/", landing_title: null, exit_path: "/", utm_source: null, utm_medium: null, utm_campaign: null,
    gclid: null, fbclid: null, ttclid: null, msclkid: null, referrer: null, device: "desktop", country: "US", region: "NY", city: "NYC",
    is_new_visitor: true, added_to_cart: false, reached_checkout: false, completed_checkout: false, ...o,
  };
}
const many = (count: number, o: Partial<SessionFact>, buyEvery = 0) =>
  Array.from({ length: count }, (_, i) => s({ ...o, completed_checkout: buyEvery > 0 && i % buyEvery === 0, reached_checkout: buyEvery > 0 && i % buyEvery === 0, added_to_cart: buyEvery > 0 && i % buyEvery === 0 }));

describe("significant", () => {
  it("separates real gaps from noise", () => {
    expect(significant(50, 1000, 10, 1000)).toBe(true);
    expect(significant(11, 1000, 10, 1000)).toBe(false);
    expect(significant(0, 0, 1, 10)).toBe(false);
  });
});

describe("behaviorTips", () => {
  it("stays quiet with too little data", () => {
    expect(behaviorTips(many(50, {}, 10), [], 30)).toEqual([]);
  });

  it("flags a real mobile conversion gap with an action plan", () => {
    const cur = [...many(700, { device: "mobile" }, 100), ...many(300, { device: "desktop" }, 20)];
    const tips = behaviorTips(cur, [], 30);
    const t = tips.find((x) => x.id === "mobile-gap");
    expect(t).toBeDefined();
    expect(t!.title).toMatch(/Phones convert \d+% worse/);
    expect(t!.actions.length).toBeGreaterThan(1);
    expect(t!.impact).toBeGreaterThan(0);
  });

  it("does not flag a mobile gap that is just noise", () => {
    const cur = [...many(700, { device: "mobile" }, 40), ...many(300, { device: "desktop" }, 38)];
    expect(behaviorTips(cur, [], 30).some((x) => x.id === "mobile-gap")).toBe(false);
  });

  it("spots a hidden-gem source and a landing page that loses people", () => {
    const cur = [
      ...many(900, { utm_source: "instagram", utm_medium: "paid_social" }, 60),
      ...many(100, { referrer: "https://www.youtube.com/" }, 8),
      ...Array.from({ length: 150 }, () => s({ landing_path: "/collections/all", pageviews: 1, ended_at: "2026-09-20T10:00:00Z" })),
    ];
    const ids = behaviorTips(cur, [], 30).map((t) => t.id);
    expect(ids).toContain("gem-youtube.com");
    expect(ids).toContain("landing-/collections/all");
  });

  it("ranks tips by estimated impact and produces some on demo data", () => {
    const all = demoSessions("2026-09-24", 60);
    const tips = behaviorTips(sessionsIn(all, { from: "2026-08-26", to: "2026-09-24" }), sessionsIn(all, { from: "2026-07-27", to: "2026-08-25" }), 30);
    expect(tips.length).toBeGreaterThan(0);
    for (let i = 1; i < tips.length; i++) expect(tips[i - 1].impact).toBeGreaterThanOrEqual(tips[i].impact);
  });
});
