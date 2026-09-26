import Link from "next/link";
import { CHANNEL_LABELS } from "@/lib/debug";
import { filterQuery, PLATFORM_LABELS } from "@/lib/dashboard/filters";
import { money, num, pct, roas, signedPct } from "@/lib/dashboard/format";
import { loadPage } from "@/lib/dashboard/page";
import { byChannel, chartRange, compareKpis, daily, delta, hourlyRevenue, performance } from "@/lib/metrics/compute";
import s from "./dashboard.module.css";
import { BarList } from "./_components/charts/BarList";
import { LineChart } from "./_components/charts/LineChart";
import { DataTable } from "./_components/DataTable";
import { Inspector, Preview } from "./_components/Inspector";
import { Card, Filters, Kpi, PageHead, PLATFORM_COLORS, TableToggle } from "./_components/ui";
import { longDay, reportDayFor } from "@/lib/daily-report";
import { STORE_TZ, storeDay } from "@/lib/tz";
import { inspectHref } from "@/lib/dashboard/inspect";

/** Rolling mean over the last `n` points (smooths daily ROAS). */
function rolling(num: number[], den: number[], n: number): (number | null)[] {
  return num.map((_, i) => {
    let a = 0;
    let b = 0;
    for (let j = Math.max(0, i - n + 1); j <= i; j++) {
      a += num[j];
      b += den[j];
    }
    return b > 0 ? a / b : null;
  });
}

export default async function Overview({ searchParams }: PageProps<"/dashboard">) {
  const { mode, data, filters: f, params } = await loadPage(searchParams);
  const cur = data.settings.currency;
  const now = Date.parse(data.generatedAt);
  const { current: k, previous: p, sameTime } = compareKpis(data, f, { now });
  const vs = sameTime ? "vs yesterday so far" : "vs prev.";
  // Short ranges still get two weeks of context in the charts, with the chosen days shaded.
  const chartR = chartRange(f.range);
  const extended = chartR.from !== f.range.from;
  const days = daily(data, { ...f, range: chartR });
  const dates = days.map((d) => d.date);
  const singleDay = f.range.from === f.range.to;
  const hours = singleDay ? hourlyRevenue(data, f, f.range.to, now) : [];
  const platforms = performance(data, f, "platform");
  const channels = byChannel(data, f);
  const ads = performance(data, f, "ad");
  const t = data.settings;
  const revDelta = delta(k.revenue, p.revenue);
  const noAdData = data.insights.length === 0;
  const metaSynced = data.adSync?.find((x) => x.platform === "meta")?.syncedAt ?? null;
  const metaAsOf = metaSynced
    ? new Date(metaSynced).toLocaleString("en-US", { timeZone: STORE_TZ, ...(storeDay(metaSynced) === storeDay(now) ? {} : { month: "short", day: "numeric" }), hour: "numeric", minute: "2-digit" })
    : null;

  const topAds = ads.filter((a) => a.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  const minSpend = Math.max(50, k.spend * 0.02);
  const attention = ads
    .filter((a) => a.spend >= minSpend && (a.roas ?? 0) < (t.breakevenRoas ?? 1))
    .sort((a, b) => (a.roas ?? 0) - (b.roas ?? 0))
    .slice(0, 6);

  return (
    <>
      <PageHead title="Overview" subtitle={t.businessName ?? "How your marketing is performing"} mode={mode} />
      <Link href="/dashboard/daily" className={s.callout} style={{ display: "flex", justifyContent: "space-between", gap: 12, textDecoration: "none", color: "inherit" }}>
        <span>
          <b>Your daily report is ready:</b> {longDay(reportDayFor(Date.parse(data.generatedAt)))}
        </span>
        <span style={{ color: "var(--s1)", whiteSpace: "nowrap" }}>Read it →</span>
      </Link>
      <Filters f={f} />

      {mode === "live" && data.orders.length === 0 && (
        <div className={s.callout}>
          No live orders yet. Numbers appear here once Shopify webhooks are connected. Switch to <strong>Demo data</strong> (top right) to explore a fully populated dashboard.
        </div>
      )}
      {mode === "live" && data.orders.length > 0 && noAdData && (
        <div className={s.callout}>Revenue is live. Ad spend, ROAS and CPA fill in once Meta, Google and TikTok are connected (Settings → Ad accounts).</div>
      )}

      <div className={s.hero}>
        <div>
          <div className={s.heroLabel}>Revenue</div>
          <div className={`${s.heroValue} ${s.countUp}`}>{money(k.revenue, cur)}</div>
        </div>
        <div className={s.heroMeta}>
          <span className={revDelta === null ? s.muted : revDelta >= 0 ? s.goodText : s.badText} style={{ fontWeight: 600 }}>
            {revDelta === null ? "—" : `${revDelta >= 0 ? "▲" : "▼"} ${signedPct(revDelta)}`}
          </span>{" "}
          {sameTime ? "vs yesterday at this time" : "vs previous period"} · {num(k.orders)} orders · {pct(k.newCustomerShare, 0)} new customers
        </div>
      </div>

      <div className={s.kpiGrid}>
        <Kpi label="Ad spend" value={money(k.spend, cur)} current={k.spend} previous={p.spend} vs={vs} neutral trend={days.map((d) => d.spend)} target={metaAsOf ? `Meta as of ${metaAsOf}` : undefined} />
        <Kpi
          label="ROAS (paid)"
          value={roas(k.roas)}
          current={k.roas}
          previous={p.roas} vs={vs}
          trend={rolling(days.map((d) => d.paidRevenue), days.map((d) => d.spend), 7)}
          target={t.targetRoas ? `Target ${roas(t.targetRoas)}` : undefined}
        />
        <Kpi label="MER (blended)" value={roas(k.mer)} current={k.mer} previous={p.mer} vs={vs} />
        <Kpi label="CPA" value={money(k.cpa, cur, { cents: false })} current={k.cpa} previous={p.cpa} vs={vs} upIsGood={false} target={t.targetCpa ? `Target ${money(t.targetCpa, cur)}` : undefined} />
        <Kpi label="New-customer ROAS" value={roas(k.ncRoas)} current={k.ncRoas} previous={p.ncRoas} vs={vs} />
        <Kpi label="AOV" value={money(k.aov, cur, { cents: true })} current={k.aov} previous={p.aov} vs={vs} />
      </div>

      <div className={s.grid2}>
        <Card title="Revenue and ad spend" sub={extended ? "Daily, last 14 days · your selected range is shaded" : "Daily, same scale"}>
          <LineChart
            label="Daily revenue and ad spend"
            dates={dates}
            highlight={extended ? f.range : undefined}
            kind="money"
            currency={cur}
            series={[
              { name: "Revenue", color: "var(--s1)", values: days.map((d) => d.revenue), area: true },
              { name: "Ad spend", color: "var(--s2)", values: days.map((d) => d.spend) },
            ]}
          />
          <TableToggle>
            <DataTable
              nameLabel="Date"
              currency={cur}
              defaultSort="name"
              columns={[
                { key: "revenue", label: "Revenue", kind: "money" },
                { key: "spend", label: "Spend", kind: "money" },
                { key: "orders", label: "Orders" },
                { key: "roas", label: "ROAS", kind: "roas" },
              ]}
              rows={days.map((d) => ({ id: d.date, name: d.date, values: { revenue: d.revenue, spend: d.spend, orders: d.orders, roas: d.roas } }))}
            />
          </TableToggle>
        </Card>
        <Card title="Paid ROAS" sub="7-day rolling, first-party attribution">
          <LineChart
            label="Rolling 7-day paid ROAS"
            dates={dates}
            highlight={extended ? f.range : undefined}
            kind="roas"
            series={[{ name: "ROAS", color: "var(--s1)", values: rolling(days.map((d) => d.paidRevenue), days.map((d) => d.spend), 7) }]}
            reference={t.targetRoas ? { value: t.targetRoas, label: `Target ${roas(t.targetRoas)}` } : undefined}
          />
          {days.some((d) => d.spend > 0) && !days.some((d) => d.paidRevenue > 0) && (
            <p className={s.cardSub} style={{ marginTop: 8 }}>
              No sales matched to a specific ad yet. Sales are matched through the tracking tags on each ad, so this fills in as tagged ads get purchases. Meta&apos;s own count is under ROAS by platform.
            </p>
          )}
        </Card>
      </div>

      {singleDay && (
        <Card title={`${longDay(f.range.to)} so far`} sub="Running revenue by hour (Eastern), against the day before. Ad platforms report spend per day, not per hour.">
          <LineChart
            label="Running revenue by hour"
            dates={hours.map((h) => `${h.hour === 0 ? 12 : h.hour > 12 ? h.hour - 12 : h.hour}${h.hour < 12 ? "am" : "pm"}`)}
            xFormat="raw"
            kind="money"
            currency={cur}
            height={180}
            series={[
              { name: "Revenue", color: "var(--s1)", values: hours.map((h) => h.revenue), area: true },
              { name: "Day before", color: "var(--ink-2)", values: hours.map((h) => h.previous), dashed: true },
            ]}
          />
          <p className={s.cardSub} style={{ marginTop: 8 }}>
            Revenue {money(k.revenue, cur)} · {num(k.orders)} orders · ad spend {money(k.spend, cur)}
          </p>
        </Card>
      )}
      {singleDay && <div style={{ height: 12 }} />}

      <div className={s.grid2}>
        <Card title="ROAS by platform" sub="Our tracking vs what each platform reports">
          {platforms.length === 0 ? (
            <div className={s.empty}>No ad spend in this range.</div>
          ) : (
            <>
              <BarList
                label="First-party ROAS by platform"
                kind="roas"
                items={platforms.map((r) => ({
                  key: r.key,
                  label: PLATFORM_LABELS[r.platform],
                  value: r.roas,
                  color: PLATFORM_COLORS[r.platform],
                  note: `platform says ${roas(r.platformRoas)}`,
                  href: inspectHref("/dashboard", f, "platform", r.key),
                  preview: <Preview data={data} f={f} level="platform" entityKey={r.key} />,
                }))}
                target={t.targetRoas ? { value: t.targetRoas, label: `target ROAS ${roas(t.targetRoas)}` } : undefined}
              />
              <TableToggle>
                <DataTable
                  nameLabel="Platform"
                  currency={cur}
                  defaultSort="spend"
                  columns={[
                    { key: "spend", label: "Spend", kind: "money" },
                    { key: "revenue", label: "Revenue", kind: "money" },
                    { key: "roas", label: "ROAS", kind: "roas" },
                    { key: "platformRoas", label: "Platform ROAS", kind: "roas" },
                    { key: "cpa", label: "CPA", kind: "money" },
                  ]}
                  rows={platforms.map((r) => ({ id: r.key, name: PLATFORM_LABELS[r.platform], color: PLATFORM_COLORS[r.platform], values: { spend: r.spend, revenue: r.revenue, roas: r.roas, platformRoas: r.platformRoas, cpa: r.cpa } }))}
                />
              </TableToggle>
            </>
          )}
        </Card>
        <Card title="Revenue by channel" sub="Share of revenue under the selected model">
          <BarList
            label="Revenue by channel"
            kind="money"
            currency={cur}
            items={channels.map((c) => ({ key: c.channel, label: CHANNEL_LABELS[c.channel] ?? c.channel, value: c.revenue, note: pct(c.share, 0) }))}
          />
          <TableToggle>
            <DataTable
              nameLabel="Channel"
              currency={cur}
              defaultSort="revenue"
              columns={[
                { key: "revenue", label: "Revenue", kind: "money" },
                { key: "orders", label: "Orders" },
                { key: "share", label: "Share", kind: "pct" },
                { key: "newCustomers", label: "New customers" },
              ]}
              rows={channels.map((c) => ({ id: c.channel, name: CHANNEL_LABELS[c.channel] ?? c.channel, values: { revenue: c.revenue, orders: c.orders, share: c.share, newCustomers: c.newCustomers } }))}
            />
          </TableToggle>
        </Card>
      </div>

      <div className={s.grid2}>
        <Card title="Top ads" sub="By attributed revenue" action={<Link className={s.button} href={`/dashboard/campaigns${filterQuery(f, { level: "ad" })}`}>All ads</Link>}>
          <DataTable
            nameLabel="Ad"
            currency={cur}
            defaultSort="revenue"
            columns={[
              { key: "spend", label: "Spend", kind: "money" },
              { key: "revenue", label: "Revenue", kind: "money" },
              { key: "roas", label: "ROAS", kind: "roas", target: t.targetRoas ? { value: t.targetRoas, better: "gte" } : undefined },
            ]}
            rows={topAds.map((a) => ({ id: a.key, name: a.name, color: PLATFORM_COLORS[a.platform], inspectHref: inspectHref("/dashboard", f, "ad", a.key), preview: <Preview data={data} f={f} level="ad" entityKey={a.key} />, values: { spend: a.spend, revenue: a.revenue, roas: a.roas } }))}
          />
        </Card>
        <Card title="Needs attention" sub={`Spending ≥ ${money(minSpend, cur)} below break-even ROAS ${roas(t.breakevenRoas ?? 1)}`}>
          <DataTable
            nameLabel="Ad"
            currency={cur}
            defaultSort="spend"
            empty="Nothing below break-even. 🎉"
            columns={[
              { key: "spend", label: "Spend", kind: "money" },
              { key: "revenue", label: "Revenue", kind: "money" },
              { key: "roas", label: "ROAS", kind: "roas", target: { value: t.breakevenRoas ?? 1, better: "gte" } },
            ]}
            rows={attention.map((a) => ({ id: a.key, name: a.name, color: PLATFORM_COLORS[a.platform], inspectHref: inspectHref("/dashboard", f, "ad", a.key), preview: <Preview data={data} f={f} level="ad" entityKey={a.key} />, values: { spend: a.spend, revenue: a.revenue, roas: a.roas } }))}
          />
        </Card>
      </div>
      <Inspector data={data} f={f} params={params} path="/dashboard" />
    </>
  );
}
