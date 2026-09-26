import "server-only";
import { after } from "next/server";
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
async function freshenAdData(): Promise<void> {
  const pull = refreshMeta(STALE_MS);
  const done = await Promise.race([pull.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), WAIT_MS))]);
  if (!done) after(() => pull.then(() => undefined));
}

/** Everything a dashboard page needs: data for the current mode and the parsed filters. */
export async function loadPage(searchParams: SearchParams) {
  const mode = await currentMode();
  if (mode === "live") await freshenAdData();
  const [data, params] = await Promise.all([getDashboardData(mode), searchParams]);
  const filters = parseFilters(params, todayUtc());
  return { mode, data, filters, params };
}
