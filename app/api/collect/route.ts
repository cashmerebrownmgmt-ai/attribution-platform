import { db } from "@/lib/db";
import { requireEnv } from "@/lib/env";
import { restitchForCheckouts } from "@/lib/stitch-runner";
import { supabaseStitchRepo } from "@/lib/stitch-store";
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

  // A checkout event can arrive after its order's webhook; re-stitch any order it now explains.
  const tokens = rows.flatMap((r) => (r.checkout_token ? [r.checkout_token] : []));
  await restitchForCheckouts(tokens, supabaseStitchRepo).catch((err) =>
    console.warn("collect: restitch failed", err instanceof Error ? err.message : err),
  );
}

export async function POST(req: Request) {
  return handleCollect(req, { config: config(), ingest });
}

export async function OPTIONS(req: Request) {
  return handleCollectPreflight(req, config());
}
