import { beforeEach, describe, expect, it } from "vitest";
import type { Attribution, TrackedEvent } from "@/lib/attribution";
import type { StitchMethod } from "@/lib/stitch";
import { restitchForCheckouts, stitchOrder, type StitchOrder, type StitchRepo } from "@/lib/stitch-runner";

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const V3 = "33333333-3333-4333-8333-333333333333";

type Saved = { orderId: string; visitorId: string | null; method: StitchMethod; attributions: Attribution[] };

let orders: Map<string, StitchOrder>;
let visitors: Set<string>;
let checkoutVisitors: Map<string, string>;
let history: Map<string, string>;
let events: TrackedEvent[];
let saved: Saved[];
let eventQueries: { visitorId: string; from: Date; to: Date }[];
let repo: StitchRepo;

const order = (o: Partial<StitchOrder> = {}): StitchOrder => ({
  id: "1001",
  created_at: "2026-09-24T12:00:00Z",
  checkout_token: "tok",
  customer_id: "c1",
  email_hash: "h1",
  note_attributes: [{ name: "_ap_vid", value: V1 }],
  ...o,
});

beforeEach(() => {
  orders = new Map([["1001", order()]]);
  visitors = new Set([V1, V2, V3]);
  checkoutVisitors = new Map([["tok", V2]]);
  history = new Map([["c1", V3]]);
  events = [
    {
      id: "e1", session_id: "s1", source: "tracker", occurred_at: "2026-09-20T10:00:00Z", is_touchpoint: true,
      utm_source: "google", utm_medium: "cpc", gclid: "g", fbclid: null, ttclid: null, msclkid: null, referrer: null,
    },
  ];
  saved = [];
  eventQueries = [];
  repo = {
    getOrder: async (id) => orders.get(id) ?? null,
    visitorExists: async (id) => visitors.has(id),
    visitorForCheckout: async (t) => checkoutVisitors.get(t) ?? null,
    visitorFromHistory: async (_id, customerId) => (customerId ? history.get(customerId) ?? null : null),
    eventsForVisitor: async (visitorId, from, to) => {
      eventQueries.push({ visitorId, from, to });
      return events;
    },
    save: async (orderId, visitorId, method, attributions) => void saved.push({ orderId, visitorId, method, attributions }),
    ordersToRestitch: async (tokens) =>
      [...orders.values()].filter((o) => o.checkout_token && tokens.includes(o.checkout_token)).map((o) => o.id),
  };
});

describe("stitchOrder", () => {
  it("stitches by cart attribute and attributes over the visitor's last 30 days", async () => {
    const r = await stitchOrder("1001", repo);
    expect(r).toMatchObject({ visitorId: V1, method: "cart_attribute" });
    expect(eventQueries[0]).toEqual({
      visitorId: V1,
      from: new Date("2026-08-25T12:00:00Z"),
      to: new Date("2026-09-24T12:00:00Z"),
    });
    expect(saved[0].attributions.map((a) => a.channel)).toEqual(["paid_search", "paid_search", "paid_search"]);
  });

  it("falls back to the checkout token when the cart visitor is unknown", async () => {
    visitors.delete(V1);
    expect(await stitchOrder("1001", repo)).toMatchObject({ visitorId: V2, method: "checkout_token" });
  });

  it("falls back to customer history, then none", async () => {
    orders.set("1001", order({ note_attributes: [], checkout_token: null }));
    expect(await stitchOrder("1001", repo)).toMatchObject({ visitorId: V3, method: "customer_history" });
    history.clear();
    const r = await stitchOrder("1001", repo);
    expect(r).toMatchObject({ visitorId: null, method: "none" });
    expect(r?.attributions.every((a) => a.channel === "direct")).toBe(true);
  });

  it("returns null for an unknown order", async () => {
    expect(await stitchOrder("nope", repo)).toBeNull();
    expect(saved).toHaveLength(0);
  });
});

describe("restitchForCheckouts", () => {
  it("re-stitches orders matching the tokens, deduplicating tokens", async () => {
    expect(await restitchForCheckouts(["tok", "tok", "other"], repo)).toBe(1);
    expect(saved.map((s) => s.orderId)).toEqual(["1001"]);
  });

  it("does nothing without tokens", async () => {
    expect(await restitchForCheckouts([], repo)).toBe(0);
  });
});
