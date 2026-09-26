import "server-only";
import { after } from "next/server";
import { refreshJourneys } from "../journey-refresh";
import { refreshMeta } from "../meta-refresh";
import { parseFilters } from "./filters";
import { currentMode, getDashboardData, todayUtc } from "./data";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STALE_MS = 15 * 60_000;
const WAIT_MS = 6_000;

/**
 * Pull fresh Meta numbers when the stored ones are over 15 minutes old. Waits up to a few seconds so
 * this page shows them; if Meta is slower, the pull finishes after the page is sent (the next load
 * or a Refresh picks it up).
 */
async function freshenAdData(): Promise<string | null> {
  const pull = Promise.all([refreshMeta(STALE_MS), refreshJourneys(STALE_MS)]);
  const done = await Promise.race([pull, new Promise<null>((r) => setTimeout(() => r(null), WAIT_MS))]);
  if (!done) after(() => pull.then(() => undefined));
  // A failed pull leaves synced_at alone, so each load retries; report the failure until one succeeds.
  return done?.[0].status === "failed" ? (done[0].message ?? "Meta sync failed") : null;
}

/** Everything a dashboard page needs: data for the current mode and the parsed filters. */
export async function loadPage(searchParams: SearchParams) {
  const mode = await currentMode();
  const metaError = mode === "live" ? await freshenAdData() : null;
  const [loaded, params] = await Promise.all([getDashboardData(mode), searchParams]);
  const data = metaError
    ? { ...loaded, syncIssue: { platform: "meta" as const, message: metaError, lastSyncedAt: loaded.adSync?.find((a) => a.platform === "meta")?.syncedAt ?? null } }
    : loaded;
  const filters = parseFilters(params, todayUtc());
  return { mode, data, filters, params };
}
