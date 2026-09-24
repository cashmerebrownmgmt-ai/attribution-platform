import "server-only";
import { parseFilters } from "./filters";
import { currentMode, getDashboardData, todayUtc } from "./data";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Everything a dashboard page needs: data for the current mode and the parsed filters. */
export async function loadPage(searchParams: SearchParams) {
  const mode = await currentMode();
  const [data, params] = await Promise.all([getDashboardData(mode), searchParams]);
  const filters = parseFilters(params, todayUtc());
  return { mode, data, filters, params };
}
