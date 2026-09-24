import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

async function migratedDb() {
  const pg = new PGlite();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return pg;
}

describe("migrations", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await migratedDb();
  });

  it("creates every Phase 1 table with RLS enabled", async () => {
    const { rows } = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`,
    );
    expect(rows).toEqual([
      { relname: "events", relrowsecurity: true },
      { relname: "order_attributions", relrowsecurity: true },
      { relname: "orders", relrowsecurity: true },
      { relname: "visitors", relrowsecurity: true },
      { relname: "webhook_events", relrowsecurity: true },
    ]);
  });

  it("rejects an unknown stitch method", async () => {
    await expect(
      pg.query(
        `insert into orders (id, created_at, ingested_via, stitch_method) values ('1', now(), 'webhook', 'guess')`,
      ),
    ).rejects.toThrow(/stitch_method/);
  });

  it("links an order, its attribution and a visitor's event", async () => {
    const vid = "11111111-1111-4111-8111-111111111111";
    const eid = "22222222-2222-4222-8222-222222222222";
    await pg.exec(`
      insert into visitors (id) values ('${vid}');
      insert into events (id, visitor_id, type, source, occurred_at, utm_source, is_touchpoint)
        values ('${eid}', '${vid}', 'page_view', 'tracker', now(), 'google', true);
      insert into orders (id, created_at, ingested_via, visitor_id, stitch_method)
        values ('1001', now(), 'webhook', '${vid}', 'cart_attribute');
      insert into order_attributions (order_id, model, event_id, channel)
        values ('1001', 'last_touch', '${eid}', 'paid_search');
    `);
    const { rows } = await pg.query(`select channel, credit from order_attributions where order_id = '1001'`);
    expect(rows).toEqual([{ channel: "paid_search", credit: "1.0000" }]);
  });
});
