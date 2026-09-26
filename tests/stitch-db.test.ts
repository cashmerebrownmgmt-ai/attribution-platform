import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { migratedDb } from "./helpers/pg";

let pg: PGlite;
const V = "11111111-1111-4111-8111-111111111111";
const E = "22222222-2222-4222-8222-222222222222";

beforeEach(async () => {
  pg = await migratedDb();
  await pg.exec(`
    insert into visitors (id) values ('${V}');
    insert into events (id, visitor_id, type, source, occurred_at, is_touchpoint) values ('${E}', '${V}', 'page_view', 'tracker', now(), true);
    insert into orders (id, created_at, ingested_via) values ('1001', now(), 'webhook');
  `);
});

const save = (visitor: string | null, method: string, attributions: unknown[]) =>
  pg.query("select public.save_stitch('1001', $1::uuid, $2, $3::jsonb)", [visitor, method, JSON.stringify(attributions)]);

describe("save_stitch", () => {
  it("sets the visitor and replaces attributions", async () => {
    await save(V, "cart_attribute", [
      { model: "first_touch", event_id: E, channel: "paid_search", credit: 1 },
      { model: "last_touch", event_id: null, channel: "direct", credit: 1 },
    ]);
    await save(V, "cart_attribute", [{ model: "last_non_direct", event_id: E, channel: "email", credit: 1 }]);
    const { rows } = await pg.query("select model, channel from order_attributions order by model");
    expect(rows).toEqual([{ model: "last_non_direct", channel: "email" }]);
    const o = await pg.query("select visitor_id, stitch_method from orders");
    expect(o.rows).toEqual([{ visitor_id: V, stitch_method: "cart_attribute" }]);
  });

  it("stores an unstitched order", async () => {
    await save(null, "none", [{ model: "first_touch", event_id: null, channel: "direct", credit: 1 }]);
    const o = await pg.query("select visitor_id, stitch_method from orders");
    expect(o.rows).toEqual([{ visitor_id: null, stitch_method: "none" }]);
  });

  it("rolls back entirely when an attribution is invalid", async () => {
    await save(V, "cart_attribute", [{ model: "first_touch", event_id: E, channel: "paid_search", credit: 1 }]);
    await expect(save(null, "none", [{ model: "bogus", event_id: null, channel: "direct", credit: 1 }])).rejects.toThrow();
    const o = await pg.query("select stitch_method from orders");
    expect(o.rows).toEqual([{ stitch_method: "cart_attribute" }]);
    const a = await pg.query("select count(*)::int n from order_attributions");
    expect(a.rows).toEqual([{ n: 1 }]);
  });
});

describe("session_facts", () => {
  const V2 = "33333333-3333-4333-8333-333333333333";
  const S1 = "44444444-4444-4444-8444-444444444444";
  const S2 = "55555555-5555-4555-8555-555555555555";
  let n = 0;
  const id = () => `66666666-6666-4666-8666-${String(++n).padStart(12, "0")}`;
  async function ev(o: Record<string, unknown>) {
    const cols = Object.keys(o);
    await pg.query(`insert into events (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(o));
  }

  it("builds one row per session with source, funnel and new/returning flags", async () => {
    await pg.exec(`insert into visitors (id, first_seen_at) values ('${V2}', '2026-09-20T10:00:00Z')`);
    // Session 1: new visitor via a campaign, adds to cart, completes checkout.
    await ev({ id: id(), visitor_id: V2, session_id: S1, type: "page_view", source: "tracker", occurred_at: "2026-09-20T10:00:00Z", path: "/", title: "Home", device: "mobile", country: "US", city: "Chicago", utm_source: "ig", utm_medium: "paid_social", is_touchpoint: true });
    await ev({ id: id(), visitor_id: V2, session_id: S1, type: "page_view", source: "tracker", occurred_at: "2026-09-20T10:01:00Z", path: "/cart" });
    await ev({ id: id(), visitor_id: V2, session_id: S1, type: "add_to_cart", source: "tracker", occurred_at: "2026-09-20T10:01:05Z", path: "/cart" });
    await ev({ id: id(), visitor_id: V2, type: "checkout_started", source: "pixel", occurred_at: "2026-09-20T10:02:00Z" });
    await ev({ id: id(), visitor_id: V2, type: "checkout_completed", source: "pixel", occurred_at: "2026-09-20T10:04:00Z" });
    // Session 2: same visitor returns directly the next day, bounces.
    await ev({ id: id(), visitor_id: V2, session_id: S2, type: "page_view", source: "tracker", occurred_at: "2026-09-21T09:00:00Z", path: "/collections/all" });

    const { rows } = await pg.query<Record<string, unknown>>("select * from public.session_facts('2026-09-19', '2026-09-22')");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ session_id: S1, pageviews: 2, landing_path: "/", exit_path: "/cart", utm_source: "ig", device: "mobile", city: "Chicago", is_new_visitor: true, added_to_cart: true, reached_checkout: true, completed_checkout: true });
    expect(rows[1]).toMatchObject({ session_id: S2, pageviews: 1, utm_source: null, is_new_visitor: false, added_to_cart: false, reached_checkout: false });
  });
});

describe("page_stats", () => {
  const V = "77777777-7777-4777-8777-777777777777";
  const S1 = "88888888-8888-4888-8888-888888888881";
  const S2 = "88888888-8888-4888-8888-888888888882";
  let n = 0;
  const id = () => `99999999-9999-4999-8999-${String(++n).padStart(12, "0")}`;
  async function pv(session: string, at: string, path: string, o: Record<string, unknown> = {}) {
    const row = { id: id(), visitor_id: V, session_id: session, type: "page_view", source: "tracker", occurred_at: at, path, url: `https://shop.example${path}`, ...o };
    const cols = Object.keys(row);
    await pg.query(`insert into events (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
  }

  it("groups days in the store's time zone by default", async () => {
    await pg.exec(`insert into visitors (id, first_seen_at) values ('77777777-7777-4777-8777-77777777777a', '2026-09-20T10:00:00Z') on conflict do nothing`);
    await pg.query(`insert into events (id, visitor_id, session_id, type, source, occurred_at, path, url) values ('99999999-9999-4999-8999-99999999999a', '77777777-7777-4777-8777-77777777777a', '88888888-8888-4888-8888-88888888888a', 'page_view', 'tracker', '2026-09-25T02:30:00Z', '/products/late-night', 'https://s.example/products/late-night')`);
    const et = await pg.query<{ day: string }>("select day::text from public.page_stats('2026-09-24', '2026-09-26') where key = 'late-night'");
    expect(et.rows).toEqual([{ day: "2026-09-24" }]); // 10:30pm Eastern on the 24th
    const utc = await pg.query<{ day: string }>("select day::text from public.page_stats('2026-09-24', '2026-09-26', 'UTC') where key = 'late-night'");
    expect(utc.rows).toEqual([{ day: "2026-09-25" }]);
  });

  it("counts product, collection and search views per day, with add-to-cart sessions", async () => {
    await pg.exec(`insert into visitors (id, first_seen_at) values ('${V}', '2026-09-20T10:00:00Z')`);
    await pv(S1, "2026-09-20T10:00:00Z", "/products/808-essentials", { title: "808 Essentials – Store" });
    await pv(S1, "2026-09-20T10:01:00Z", "/en-us/collections/drum-kits/products/808-Essentials");
    await pv(S1, "2026-09-20T10:02:00Z", "/collections/drum-kits");
    await pv(S1, "2026-09-20T10:03:00Z", "/search", { url: "https://shop.example/search?q=Trap+Drums&type=product" });
    await pv(S1, "2026-09-20T10:04:00Z", "/search", { url: "https://shop.example/search?q=me%40mail.com" });
    await pv(S1, "2026-09-20T10:05:00Z", "/search", { url: "https://shop.example/search?q=5551234567" });
    await pg.query(`insert into events (id, visitor_id, session_id, type, source, occurred_at, path) values ($1, $2, $3, 'add_to_cart', 'tracker', '2026-09-20T10:06:00Z', '/cart')`, [id(), V, S1]);
    await pv(S2, "2026-09-21T09:00:00Z", "/products/808-essentials");

    const { rows } = await pg.query<Record<string, unknown>>("select day::text, kind, key, title, views, sessions, carts from public.page_stats('2026-09-19', '2026-09-22', 'UTC')");
    expect(rows).toEqual([
      { day: "2026-09-20", kind: "collection", key: "drum-kits", title: null, views: 1, sessions: 1, carts: 1 },
      { day: "2026-09-20", kind: "product", key: "808-essentials", title: "808 Essentials – Store", views: 2, sessions: 1, carts: 1 },
      { day: "2026-09-20", kind: "search", key: "trap+drums", title: null, views: 1, sessions: 1, carts: 1 },
      { day: "2026-09-21", kind: "product", key: "808-essentials", title: null, views: 1, sessions: 1, carts: 0 },
    ]);
  });
});

describe("alert_log", () => {
  it("exists with RLS on and no policies", async () => {
    const { rows } = await pg.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'alert_log'");
    expect(rows).toEqual([{ relrowsecurity: true }]);
    const p = await pg.query("select 1 from pg_policies where tablename = 'alert_log'");
    expect(p.rows).toHaveLength(0);
  });
});

describe("daily_reports", () => {
  it("stores one snapshot per day, with RLS on and no policies", async () => {
    await pg.query(`insert into daily_reports (day, generated_at, report) values ('2026-09-24', now(), '{"summary": ["a"]}')`);
    await pg.query(`insert into daily_reports (day, generated_at, report) values ('2026-09-24', now(), '{"summary": ["b"]}') on conflict (day) do update set report = excluded.report`);
    const { rows } = await pg.query<{ report: { summary: string[] } }>("select report from daily_reports");
    expect(rows).toEqual([{ report: { summary: ["b"] } }]);
    const rls = await pg.query("select 1 from pg_class where relname = 'daily_reports' and relrowsecurity");
    expect(rls.rows).toHaveLength(1);
    const p = await pg.query("select 1 from pg_policies where tablename = 'daily_reports'");
    expect(p.rows).toHaveLength(0);
  });
});

describe("ad_account_daily", () => {
  it("stores one total per account and day, with RLS on", async () => {
    await pg.exec(`insert into ad_accounts (platform, id, name, synced_at) values ('meta', '42', 'CB', now())`);
    await pg.exec(`insert into ad_account_daily (platform, account_id, date, spend) values ('meta', '42', '2026-09-25', 97.99)`);
    await pg.exec(`insert into ad_account_daily (platform, account_id, date, spend) values ('meta', '42', '2026-09-25', 101.50) on conflict (platform, account_id, date) do update set spend = excluded.spend`);
    const { rows } = await pg.query("select spend::text from ad_account_daily");
    expect(rows).toEqual([{ spend: "101.50" }]);
    const rls = await pg.query("select 1 from pg_class where relname = 'ad_account_daily' and relrowsecurity");
    expect(rls.rows).toHaveLength(1);
  });
});
