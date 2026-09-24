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
