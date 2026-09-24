import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");

let template: Promise<PGlite> | undefined;

async function buildTemplate(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return pg;
}

/**
 * A fresh in-process Postgres with Supabase's API roles and every migration applied.
 * Migrations run once per test file; each call returns an independent clone.
 */
export async function migratedDb(): Promise<PGlite> {
  template ??= buildTemplate();
  return (await (await template).clone()) as PGlite;
}
