import { CHANNEL_LABELS } from "@/lib/debug";
import { PLATFORM_LABELS } from "@/lib/dashboard/filters";
import { pct, roas } from "@/lib/dashboard/format";
import { loadPage } from "@/lib/dashboard/page";
import { byChannel, daysIn, insightsIn, performance } from "@/lib/metrics/compute";
import { AD_PLATFORMS } from "@/lib/metrics/types";
import s from "../dashboard.module.css";
import { BarList } from "../_components/charts/BarList";
import { LineChart } from "../_components/charts/LineChart";
import { DataTable } from "../_components/DataTable";
import { Card, Filters, PageHead, PLATFORM_COLORS, TableToggle } from "../_components/ui";

export default async function ChannelsPage({ searchParams }: PageProps<"/dashboard/channels">) {
  const { mode, data, filters: f } = await loadPage(searchParams);
  const cur = data.settings.currency;
  const t = data.settings;
  const channels = byChannel(data, f);
  const platforms = performance(data, f, "platform");
  const dates = daysIn(f.range);

  const spendByPlatform = new Map(AD_PLATFORMS.map((p) => [p, new Map(dates.map((d) => [d, 0]))]));
  for (const i of insightsIn(data, f.range, f.platform)) {
    const m = spendByPlatform.get(i.platform);
    if (m?.has(i.date)) m.set(i.date, (m.get(i.date) ?? 0) + i.spend);
  }
  const activePlatforms = AD_PLATFORMS.filter((p) => platforms.some((r) => r.platform === p));

  return (
    <>
      <PageHead title="Channels" subtitle="Where revenue comes from, and what each ad platform returns" mode={mode} />
      <Filters f={f} />

      <div className={s.grid2}>
        <Card title="Revenue by channel" sub="Credit under the selected attribution model">
          <BarList
            label="Revenue by channel"
            kind="money"
            currency={cur}
            items={channels.map((c) => ({ key: c.channel, label: CHANNEL_LABELS[c.channel] ?? c.channel, value: c.revenue, note: `${pct(c.share, 0)} · ${c.orders} orders` }))}
          />
        </Card>
        <Card title="Daily spend by platform" sub="Same scale for all platforms">
          {activePlatforms.length === 0 ? (
            <div className={s.empty}>No ad spend in this range.</div>
          ) : (
            <LineChart
              label="Daily ad spend by platform"
              dates={dates}
              kind="money"
              currency={cur}
              series={activePlatforms.map((p) => ({ name: PLATFORM_LABELS[p], color: PLATFORM_COLORS[p], values: dates.map((d) => spendByPlatform.get(p)?.get(d) ?? 0) }))}
            />
          )}
        </Card>
      </div>

      <div className={s.stack}>
        <Card title="Channels" sub="Revenue, orders and new customers">
          <DataTable
            nameLabel="Channel"
            currency={cur}
            defaultSort="revenue"
            columns={[
              { key: "revenue", label: "Revenue", kind: "money" },
              { key: "share", label: "Share", kind: "pct" },
              { key: "orders", label: "Orders" },
              { key: "aov", label: "AOV", kind: "money" },
              { key: "newCustomers", label: "New customers" },
              { key: "newShare", label: "New %", kind: "pct" },
            ]}
            rows={channels.map((c) => ({
              id: c.channel,
              name: CHANNEL_LABELS[c.channel] ?? c.channel,
              values: { revenue: c.revenue, share: c.share, orders: c.orders, aov: c.orders ? c.revenue / c.orders : null, newCustomers: c.newCustomers, newShare: c.orders ? c.newCustomers / c.orders : null },
            }))}
          />
        </Card>
        <Card title="Ad platforms" sub={`First-party ROAS vs platform-reported ROAS${t.targetRoas ? ` · target ${roas(t.targetRoas)}` : ""}`}>
          <DataTable
            nameLabel="Platform"
            currency={cur}
            defaultSort="spend"
            empty="No ad platforms connected yet."
            columns={[
              { key: "spend", label: "Spend", kind: "money" },
              { key: "impressions", label: "Impressions" },
              { key: "ctr", label: "CTR", kind: "pct" },
              { key: "cpm", label: "CPM", kind: "money" },
              { key: "cpc", label: "CPC", kind: "money" },
              { key: "orders", label: "Orders" },
              { key: "revenue", label: "Revenue", kind: "money" },
              { key: "roas", label: "ROAS", kind: "roas", target: t.targetRoas ? { value: t.targetRoas, better: "gte" } : undefined },
              { key: "platformRoas", label: "Platform ROAS", kind: "roas" },
              { key: "cpa", label: "CPA", kind: "money", target: t.targetCpa ? { value: t.targetCpa, better: "lte" } : undefined },
              { key: "newCustomers", label: "New cust." },
            ]}
            rows={platforms.map((r) => ({
              id: r.key,
              name: PLATFORM_LABELS[r.platform],
              color: PLATFORM_COLORS[r.platform],
              values: { spend: r.spend, impressions: r.impressions, ctr: r.ctr, cpm: r.cpm, cpc: r.cpc, orders: r.orders, revenue: r.revenue, roas: r.roas, platformRoas: r.platformRoas, cpa: r.cpa, newCustomers: r.newCustomers },
            }))}
          />
          <TableToggle label="Why do the platforms report higher ROAS?">
            <p className={s.cardSub} style={{ fontSize: 13, maxWidth: 720 }}>
              Each ad platform counts a sale if someone saw or clicked its ad within its own window, so several platforms often claim the same order. First-party ROAS gives each order to exactly one touchpoint under the selected model, so it adds up to your real revenue.
            </p>
          </TableToggle>
        </Card>
      </div>
    </>
  );
}
