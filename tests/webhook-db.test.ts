import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { OrderRow } from "@/lib/shopify";
import { migratedDb } from "./helpers/pg";

let pg: PGlite;
beforeEach(async () => {
  pg = await migratedDb();
});

const order = (o: Partial<OrderRow> = {}): OrderRow => ({
  id: "1001",
  name: "#1001",
  created_at: "2026-09-24T18:00:00Z",
  total_price: "84.50",
  subtotal_price: "75.00",
  currency: "USD",
  financial_status: "paid",
  cancelled_at: null,
  checkout_token: "tok",
  cart_token: null,
  customer_id: "c1",
  email_hash: "hash1",
  landing_site: null,
  referring_site: null,
  source_name: "web",
  note_attributes: [],
  ingested_via: "webhook",
  shopify_updated_at: "2026-09-24T18:00:05Z",
  ...o,
});

const upsert = (o: OrderRow) => pg.query("select public.upsert_order($1::jsonb)", [JSON.stringify(o)]);
const get = async () =>
  (await pg.query<Record<string, unknown>>("select * from orders where id = '1001'")).rows[0];

describe("claim_webhook", () => {
  const claim = async (id: string) =>
    (await pg.query<{ ok: boolean }>("select public.claim_webhook($1, 'orders/create', 'shop') as ok", [id])).rows[0].ok;

  it("processes a new delivery, retries an unfinished one, skips a finished one", async () => {
    expect(await claim("w1")).toBe(true);
    expect(await claim("w1")).toBe(true); // first attempt never finished
    await pg.query("update webhook_events set processed_at = now() where webhook_id = 'w1'");
    expect(await claim("w1")).toBe(false);
  });
});

describe("upsert_order", () => {
  it("inserts, then applies newer updates", async () => {
    await upsert(order());
    await upsert(order({ financial_status: "refunded", shopify_updated_at: "2026-09-25T00:00:00Z" }));
    expect((await get()).financial_status).toBe("refunded");
  });

  it("ignores an older, out-of-order update", async () => {
    await upsert(order({ financial_status: "refunded", shopify_updated_at: "2026-09-25T00:00:00Z" }));
    await upsert(order({ financial_status: "paid" }));
    expect((await get()).financial_status).toBe("refunded");
  });

  it("never lets a backfill of the same version replace a webhook row", async () => {
    await upsert(order());
    await upsert(order({ ingested_via: "backfill", total_price: "1.00" }));
    expect(await get()).toMatchObject({ ingested_via: "webhook", total_price: "84.50" });
  });

  it("keeps the webhook label when a newer backfill arrives", async () => {
    await upsert(order());
    await upsert(order({ ingested_via: "backfill", shopify_updated_at: "2026-09-26T00:00:00Z", total_price: "80.00" }));
    expect(await get()).toMatchObject({ ingested_via: "webhook", total_price: "80.00" });
  });

  it("does not touch stitching columns", async () => {
    await upsert(order());
    await pg.exec(`
      insert into visitors (id) values ('11111111-1111-4111-8111-111111111111');
      update orders set visitor_id = '11111111-1111-4111-8111-111111111111', stitch_method = 'cart_attribute';
    `);
    await upsert(order({ shopify_updated_at: "2026-09-25T00:00:00Z" }));
    expect(await get()).toMatchObject({ visitor_id: "11111111-1111-4111-8111-111111111111", stitch_method: "cart_attribute" });
  });
});

describe("redaction", () => {
  it("redact_customer strips identifiers from matching orders only", async () => {
    await upsert(order());
    await upsert(order({ id: "1002", customer_id: "c2", email_hash: "hash2" }));
    await pg.query("select public.redact_customer('c1', null, '{}')");
    const { rows } = await pg.query("select id, customer_id, email_hash from orders order by id");
    expect(rows).toEqual([
      { id: "1001", customer_id: null, email_hash: null },
      { id: "1002", customer_id: "c2", email_hash: "hash2" },
    ]);
  });

  it("redact_shop deletes all store data but keeps the webhook log", async () => {
    await upsert(order());
    await pg.exec(`
      insert into visitors (id) values ('11111111-1111-4111-8111-111111111111');
      insert into webhook_events (webhook_id, topic, shop_domain) values ('w', 'shop/redact', 's');
    `);
    await pg.query("select public.redact_shop()");
    const { rows } = await pg.query(`
      select (select count(*) from orders)::int o, (select count(*) from visitors)::int v,
             (select count(*) from webhook_events)::int w`);
    expect(rows[0]).toEqual({ o: 0, v: 0, w: 1 });
  });

  it("none of the webhook functions are callable by public API roles", async () => {
    const { rows } = await pg.query<{ n: number }>(`
      select count(*)::int n from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('claim_webhook','upsert_order','redact_customer','redact_shop')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
    expect(rows[0].n).toBe(0);
  });
});

describe("join_team", () => {
  const join = async (id: string, email: string) =>
    (await pg.query<{ role: string | null }>("select public.join_team($1::uuid, $2) as role", [id, email])).rows[0].role;
  const U1 = "11111111-1111-4111-8111-111111111111";
  const U2 = "22222222-2222-4222-8222-222222222222";
  const U3 = "33333333-3333-4333-8333-333333333333";

  it("makes the first person owner, then admits only invited emails", async () => {
    expect(await join(U1, " Owner@Example.com ")).toBe("owner");
    expect(await join(U1, "owner@example.com")).toBe("owner"); // idempotent
    expect(await join(U2, "stranger@example.com")).toBeNull();

    await pg.query("insert into invites (email, role) values ('teammate@example.com', 'viewer')");
    expect(await join(U3, "Teammate@example.com")).toBe("viewer");
    const { rows } = await pg.query("select count(*)::int n from invites");
    expect(rows).toEqual([{ n: 0 }]); // invite used up
  });
});
