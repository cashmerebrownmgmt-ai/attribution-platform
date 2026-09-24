import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { EventRow } from "@/lib/collect";
import { migratedDb } from "./helpers/pg";

const VID = "11111111-1111-4111-8111-111111111111";

function row(id: number, overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    visitor_id: VID,
    session_id: null,
    type: "page_view",
    source: "tracker",
    occurred_at: "2026-09-24T12:00:00.000Z",
    url: "https://shop.example.com/",
    path: "/",
    referrer: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    gclid: null,
    fbclid: null,
    ttclid: null,
    msclkid: null,
    checkout_token: null,
    shopify_order_id: null,
    user_agent: null,
    ip_hash: null,
    is_touchpoint: false,
    ...overrides,
  };
}

let pg: PGlite;
const ingest = async (rows: EventRow[]) =>
  (await pg.query<{ n: number }>("select public.ingest_events($1::jsonb) as n", [JSON.stringify(rows)])).rows[0].n;

beforeEach(async () => {
  pg = await migratedDb();
});

describe("ingest_events", () => {
  it("creates the visitor and stores events, returning how many were new", async () => {
    expect(await ingest([row(1), row(2)])).toBe(2);
    const { rows } = await pg.query("select count(*)::int as n from events where visitor_id = $1", [VID]);
    expect(rows).toEqual([{ n: 2 }]);
  });

  it("ignores duplicate event IDs, across and within batches", async () => {
    await ingest([row(1)]);
    expect(await ingest([row(1), row(2), row(2)])).toBe(1);
    const { rows } = await pg.query("select count(*)::int as n from events");
    expect(rows).toEqual([{ n: 2 }]);
  });

  it("widens first/last seen and keeps the first touchpoint once set", async () => {
    await ingest([
      row(1, { occurred_at: "2026-09-20T10:00:00Z" }),
      row(2, { occurred_at: "2026-09-20T11:00:00Z", is_touchpoint: true, utm_source: "google", utm_medium: "cpc" }),
      row(3, { occurred_at: "2026-09-20T12:00:00Z", is_touchpoint: true, utm_source: "meta" }),
    ]);
    await ingest([row(4, { occurred_at: "2026-09-22T09:00:00Z", is_touchpoint: true, utm_source: "email" })]);

    const { rows } = await pg.query<{ first_seen_at: Date; last_seen_at: Date; first_touch: Record<string, string> }>(
      "select first_seen_at, last_seen_at, first_touch from visitors where id = $1",
      [VID],
    );
    expect(rows[0].first_seen_at.toISOString()).toBe("2026-09-20T10:00:00.000Z");
    expect(rows[0].last_seen_at.toISOString()).toBe("2026-09-22T09:00:00.000Z");
    expect(rows[0].first_touch).toMatchObject({ utm_source: "google", utm_medium: "cpc", event_id: row(2).id });
    expect(rows[0].first_touch).not.toHaveProperty("gclid"); // nulls stripped
  });

  it("leaves first_touch empty until a touchpoint arrives", async () => {
    await ingest([row(1)]);
    await ingest([row(2, { is_touchpoint: true, utm_source: "tiktok" })]);
    const { rows } = await pg.query<{ first_touch: { utm_source: string } }>("select first_touch from visitors");
    expect(rows[0].first_touch.utm_source).toBe("tiktok");
  });

  it("is not callable by the public API roles", async () => {
    const { rows } = await pg.query<{ anon: boolean; authed: boolean }>(`
      select has_function_privilege('anon', 'public.ingest_events(jsonb)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.ingest_events(jsonb)', 'execute') as authed`);
    expect(rows[0]).toEqual({ anon: false, authed: false });
  });
});
