import { describe, expect, it } from "vitest";
import { attribute, sessionsBefore, type TrackedEvent } from "@/lib/attribution";
import { cartVisitorIdFrom, stitch } from "@/lib/stitch";

const ORDER_AT = new Date("2026-09-24T12:00:00Z");
const daysBefore = (d: number, extraMs = 0) => new Date(ORDER_AT.getTime() - d * 86_400_000 + extraMs).toISOString();

let n = 0;
function ev(o: Partial<TrackedEvent> & { at: string; session?: string }): TrackedEvent {
  const { at, session, ...rest } = o;
  return {
    id: `e${++n}`,
    session_id: session ?? null,
    source: "tracker",
    occurred_at: at,
    is_touchpoint: false,
    utm_source: null,
    utm_medium: null,
    gclid: null,
    fbclid: null,
    ttclid: null,
    msclkid: null,
    referrer: null,
    ...rest,
  };
}
const touch = (at: string, session: string, o: Partial<TrackedEvent>) => ev({ at, session, is_touchpoint: true, ...o });

describe("stitch", () => {
  const vid = "11111111-1111-4111-8111-111111111111";
  it("prefers cart attribute, then checkout token, then customer history", () => {
    expect(stitch({ cartVisitorId: "a", checkoutVisitorId: "b", historyVisitorId: "c" })).toEqual({ visitorId: "a", method: "cart_attribute" });
    expect(stitch({ cartVisitorId: null, checkoutVisitorId: "b", historyVisitorId: "c" })).toEqual({ visitorId: "b", method: "checkout_token" });
    expect(stitch({ cartVisitorId: null, checkoutVisitorId: null, historyVisitorId: "c" })).toEqual({ visitorId: "c", method: "customer_history" });
    expect(stitch({ cartVisitorId: null, checkoutVisitorId: null, historyVisitorId: null })).toEqual({ visitorId: null, method: "none" });
  });

  it("reads a well-formed visitor ID from note attributes", () => {
    expect(cartVisitorIdFrom([{ name: "gift", value: "x" }, { name: "_ap_vid", value: ` ${vid.toUpperCase()} ` }])).toBe(vid);
    expect(cartVisitorIdFrom([{ name: "_ap_vid", value: "junk" }])).toBeNull();
    expect(cartVisitorIdFrom([])).toBeNull();
    expect(cartVisitorIdFrom(null)).toBeNull();
  });
});

describe("sessionsBefore", () => {
  it("groups by session, uses the first touchpoint as the source, ignores pixel events", () => {
    const s = sessionsBefore(
      [
        ev({ at: daysBefore(2), session: "s1" }),
        touch(daysBefore(2, 1000), "s1", { utm_source: "google", utm_medium: "cpc" }),
        touch(daysBefore(2, 2000), "s1", { utm_source: "later" }),
        ev({ at: daysBefore(0, -1000), source: "pixel" }),
      ],
      ORDER_AT,
    );
    expect(s).toHaveLength(1);
    expect(s[0].touch?.utm_source).toBe("google");
  });

  it("respects the 30-day window and ignores events after the order", () => {
    const s = sessionsBefore(
      [
        touch(daysBefore(30, -1), "old", { utm_source: "old" }), // just outside
        touch(daysBefore(30), "edge", { utm_source: "edge" }), // exactly 30 days: inside
        touch(daysBefore(0, 1), "after", { utm_source: "after" }),
      ],
      ORDER_AT,
    );
    expect(s.map((x) => x.touch?.utm_source)).toEqual(["edge"]);
  });

  it("treats events without a session ID as separate sessions", () => {
    expect(sessionsBefore([ev({ at: daysBefore(1) }), ev({ at: daysBefore(1, 1) })], ORDER_AT)).toHaveLength(2);
  });
});

describe("attribute", () => {
  it("credits first, last and last non-direct sessions", () => {
    const events = [
      touch(daysBefore(10), "s1", { utm_source: "tiktok", utm_medium: "paid_social", ttclid: "t" }),
      touch(daysBefore(5), "s2", { utm_source: "newsletter", utm_medium: "email" }),
      ev({ at: daysBefore(1), session: "s3" }), // direct return visit
    ];
    const byModel = Object.fromEntries(attribute(events, ORDER_AT).map((a) => [a.model, a]));
    expect(byModel.first_touch).toMatchObject({ channel: "paid_social", event_id: events[0].id, credit: 1 });
    expect(byModel.last_touch).toMatchObject({ channel: "direct", event_id: null });
    expect(byModel.last_non_direct).toMatchObject({ channel: "email", event_id: events[1].id });
  });

  it("returns direct for all models with no sessions", () => {
    expect(attribute([], ORDER_AT)).toEqual([
      { model: "first_touch", event_id: null, channel: "direct", credit: 1 },
      { model: "last_touch", event_id: null, channel: "direct", credit: 1 },
      { model: "last_non_direct", event_id: null, channel: "direct", credit: 1 },
    ]);
  });

  it("classifies a touchpoint by external referrer", () => {
    const a = attribute([touch(daysBefore(1), "s", { referrer: "https://www.google.com/" })], ORDER_AT);
    expect(a.map((x) => x.channel)).toEqual(["organic_search", "organic_search", "organic_search"]);
  });
});
