/**
 * The store's time zone. Every "day" on the dashboard (Today, Yesterday, date ranges, charts, the
 * daily report) is a calendar day here, matching Shopify's reports. Shopify and the Meta ad account
 * are both set to America/New_York.
 */
export const STORE_TZ = "America/New_York";

const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
// Time-zone offsets only change on the hour, so cache by UTC hour (a few thousand entries at most).
const byHour = new Map<number, string>();

/** YYYY-MM-DD of an instant in the store's time zone. Date-only strings pass through unchanged. */
export function storeDay(at: string | number | Date): string {
  if (typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const ms = typeof at === "number" ? at : typeof at === "string" ? Date.parse(at) : at.getTime();
  if (!Number.isFinite(ms)) return typeof at === "string" ? at.slice(0, 10) : "";
  const hour = Math.floor(ms / 3_600_000);
  let day = byHour.get(hour);
  if (day === undefined) {
    day = formatter.format(new Date(ms));
    byHour.set(hour, day);
  }
  return day;
}

/** Today's date in the store's time zone. */
export const storeToday = () => storeDay(Date.now());
