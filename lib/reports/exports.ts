/** Tabular exports for every dashboard view, as CSV-ready headers + rows. Pure. */
import { MODEL_LABELS, PLATFORM_LABELS } from "../dashboard/filters";
import { storeDateTime } from "../tz";
import { CHANNEL_LABELS } from "../debug";
import { byChannel, daily, ordersIn, performance, type Filters, type PerfRow } from "../metrics/compute";
import type { DashboardData } from "../metrics/types";
import type { CsvValue } from "./csv";

export const EXPORT_VIEWS = {
  daily: "Daily performance",
  channels: "Channels",
  platforms: "Ad platforms",
  campaigns: "Campaigns",
  ads: "Ads",
  orders: "Orders",
} as const;
export type ExportView = keyof typeof EXPORT_VIEWS;

export const isExportView = (v: unknown): v is ExportView => typeof v === "string" && v in EXPORT_VIEWS;

const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const r4 = (n: number | null) => (n === null ? null : Math.round(n * 10000) / 10000);

const PERF_HEADERS = ["Spend", "Impressions", "Clicks", "CTR", "CPM", "CPC", "Orders", "Revenue", "ROAS", "Platform revenue", "Platform ROAS", "CPA", "New customers"];
const perfCells = (r: PerfRow): CsvValue[] => [
  r2(r.spend), r.impressions, r.clicks, r4(r.ctr), r2(r.cpm), r2(r.cpc), r.orders, r2(r.revenue), r2(r.roas), r2(r.platformRevenue), r2(r.platformRoas), r2(r.cpa), r.newCustomers,
];

export function exportTable(data: DashboardData, f: Filters, view: ExportView): { headers: string[]; rows: CsvValue[][] } {
  switch (view) {
    case "daily":
      return {
        headers: ["Date", "Revenue", "Paid revenue", "Ad spend", "Orders", "Paid ROAS"],
        rows: daily(data, f).map((d) => [d.date, d.revenue, d.paidRevenue, d.spend, d.orders, r2(d.roas)]),
      };
    case "channels":
      return {
        headers: ["Channel", "Revenue", "Share", "Orders", "New customers"],
        rows: byChannel(data, f).map((c) => [CHANNEL_LABELS[c.channel] ?? c.channel, c.revenue, r4(c.share), c.orders, c.newCustomers]),
      };
    case "platforms":
      return {
        headers: ["Platform", ...PERF_HEADERS],
        rows: performance(data, f, "platform").map((r) => [PLATFORM_LABELS[r.platform], ...perfCells(r)]),
      };
    case "campaigns":
      return {
        headers: ["Platform", "Campaign ID", "Campaign", "Status", ...PERF_HEADERS],
        rows: performance(data, f, "campaign").map((r) => [PLATFORM_LABELS[r.platform], r.key.split(":")[1], r.name, r.status, ...perfCells(r)]),
      };
    case "ads": {
      const ads = new Map(data.ads.map((a) => [`${a.platform}:${a.id}`, a]));
      const campaigns = new Map(data.campaigns.map((c) => [`${c.platform}:${c.id}`, c.name]));
      return {
        headers: ["Platform", "Ad ID", "Ad", "Campaign", "Format", "Status", ...PERF_HEADERS],
        rows: performance(data, f, "ad").map((r) => {
          const ad = ads.get(r.key);
          return [PLATFORM_LABELS[r.platform], r.key.split(":")[1], r.name, ad ? campaigns.get(`${ad.platform}:${ad.campaignId}`) ?? "" : "", ad?.format ?? "", r.status, ...perfCells(r)];
        }),
      };
    }
    case "orders": {
      const m = f.model;
      return {
        headers: ["Order", "Created (Eastern)", "Revenue", "New customer", "Matched by", `Channel (${MODEL_LABELS[m]})`, "Platform", "Campaign ID", "Ad ID"],
        rows: ordersIn(data, f.range)
          .filter((o) => f.platform === "all" || o.touches[m].platform === f.platform)
          .map((o) => [o.name, storeDateTime(o.createdAt), o.revenue, o.isNew ? "yes" : "no", o.stitchMethod, CHANNEL_LABELS[o.touches[m].channel] ?? o.touches[m].channel, o.touches[m].platform ?? "", o.touches[m].campaignId ?? "", o.touches[m].adId ?? ""]),
      };
    }
  }
}
