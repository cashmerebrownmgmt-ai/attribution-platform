import { db } from "@/lib/db";
import { requireEnv } from "@/lib/env";
import {
  handleCollect,
  handleCollectPreflight,
  parseAllowedOrigins,
  type CollectConfig,
  type EventRow,
} from "@/lib/collect";

function config(): CollectConfig {
  return {
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
    ipHashSalt: requireEnv("IP_HASH_SALT"),
  };
}

async function ingest(rows: EventRow[]): Promise<void> {
  const { error } = await db().rpc("ingest_events", { p_events: rows });
  if (error) throw new Error(`ingest_events failed: ${error.message}`);
}

export async function POST(req: Request) {
  return handleCollect(req, { config: config(), ingest });
}

export async function OPTIONS(req: Request) {
  return handleCollectPreflight(req, config());
}
