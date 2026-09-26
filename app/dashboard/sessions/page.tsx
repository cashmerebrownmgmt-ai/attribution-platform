import Link from "next/link";
import { filterQuery } from "@/lib/dashboard/filters";
import { num, pct } from "@/lib/dashboard/format";
import { loadPage } from "@/lib/dashboard/page";
import { todayUtc } from "@/lib/dashboard/data";
import { breakdown, DIMENSION_LABELS, formatDuration, previousSessionRange, sessionKpis, sessionsByDay, sessionsByHour, sessionsIn, type Dimension } from "@/lib/sessions";
import { loadSessions } from "@/lib/sessions-data";
import s from "../dashboard.module.css";
import { LineChart } from "../_components/charts/LineChart";
import { DataTable } from "../_components/DataTable";
import { Card, Filters, Kpi, PageHead, TableToggle } from "../_components/ui";
import { ShopifyComparison } from "./ShopifyComparison";
import { Tips } from "../_components/Tips";
import { behaviorTips } from "@/lib/behavior-insights";
import { daysIn } from "@/lib/metrics/compute";

const DIMS: Dimension[] = ["channel", "source", "campaign", "landing", "exit", "device", "visitorType", "country", "region", "city", "referrer"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SessionsPage({ searchParams }: PageProps<"/dashboard/sessions">) {
  const { mode, data, filters: f, params } = await loadPage(searchParams);
  const facts = await loadSessions(mode, f.range, todayUtc());
  const cur = sessionsIn(facts, f.range);
  const prev = sessionsIn(facts, previousSessionRange(f.range));
  const k = sessionKpis(cur);
  const p = sessionKpis(prev);
  // Charts cover exactly the selected range: by day, or by hour for a single day.
  const hourly = f.range.from === f.range.to;
  const days = hourly
    ? sessionsByHour(facts, f.range.to, Date.parse(data.generatedAt)).map((h) => ({ date: h.label, sessions: h.sessions, visitors: h.visitors, conversions: h.conversions, conversionRate: h.sessions ? (h.conversions ?? 0) / h.sessions : null }))
    : sessionsByDay(cur, f.range);
  const dim = DIMS.find((d) => d === one(params.dim)) ?? "channel";
  const rows = breakdown(cur, dim, 50);
  const maxFunnel = Math.max(1, k.funnel[0].sessions);
  const tips = behaviorTips(cur, prev, daysIn(f.range).length);

  return (
    <>
      <PageHead title="Sessions" subtitle="Traffic, engagement and conversion from your own tracking" mode={mode} />
      <Filters f={f} showPlatform={false} showModel={false} />

      {mode === "live" && cur.length === 0 && (
        <div className={s.callout}>No sessions in this range yet. They appear as soon as visitors browse your store with the tracking script installed.</div>
      )}

      <Card title="What to improve, based on how people shop" sub="Ranked by estimated extra orders. Tips only appear when the pattern is strong enough not to be noise.">
        <Tips tips={tips} />
      </Card>
      <div style={{ height: 12 }} />

      <div className={s.kpiGrid}>
        <Kpi label="Sessions" value={num(k.sessions)} current={k.sessions} previous={p.sessions} trend={days.map((d) => d.sessions)} />
        <Kpi label="Visitors" value={num(k.visitors)} current={k.visitors} previous={p.visitors} />
        <Kpi label="New visitors" value={num(k.newVisitors)} current={k.newVisitors} previous={p.newVisitors} target={k.visitors ? `${pct(k.newVisitors / k.visitors, 0)} of visitors` : undefined} />
        <Kpi label="Conversion rate" value={pct(k.conversionRate, 2)} current={k.conversionRate} previous={p.conversionRate} trend={days.map((d) => d.conversionRate)} />
        <Kpi label="Bounce rate" value={pct(k.bounceRate, 1)} current={k.bounceRate} previous={p.bounceRate} upIsGood={false} />
        <Kpi label="Pages / session" value={k.pagesPerSession?.toFixed(2) ?? "—"} current={k.pagesPerSession} previous={p.pagesPerSession} />
        <Kpi label="Avg. session" value={formatDuration(k.avgDurationSec)} current={k.avgDurationSec} previous={p.avgDurationSec} />
        <Kpi label="Add-to-cart rate" value={pct(k.addToCartRate, 1)} current={k.addToCartRate} previous={p.addToCartRate} />
      </div>

      <div className={s.grid2}>
        <Card title="Conversion funnel" sub="Share of sessions reaching each step">
          <div className={s.funnel}>
            {k.funnel.map((step, i) => {
              const prevStep = i > 0 ? k.funnel[i - 1].sessions : null;
              const drop = prevStep ? 1 - step.sessions / prevStep : null;
              return (
                <div key={step.label} className={s.funnelRow}>
                  <div className={s.funnelLabel}>
                    <b>{step.label}</b>
                    <span className={s.muted}>
                      {num(step.sessions)} · {pct(step.rate, i === 0 ? 0 : 2)}
                    </span>
                  </div>
                  <div className={s.funnelTrack}>
                    <span className={s.growX} style={{ width: `${(step.sessions / maxFunnel) * 100}%` }} />
                  </div>
                  {drop !== null && <div className={s.funnelDrop}>{pct(drop, 0)} dropped off</div>}
                </div>
              );
            })}
          </div>
          <p className={s.cardSub} style={{ marginTop: 10 }}>Previous period: {pct(p.addToCartRate, 1)} added to cart · {pct(p.checkoutRate, 1)} reached checkout · {pct(p.conversionRate, 2)} purchased</p>
        </Card>
        <Card title="Sessions and visitors" sub={hourly ? "By hour (Eastern)" : "Daily"}>
          <LineChart
            label={hourly ? "Sessions and visitors by hour" : "Daily sessions and visitors"}
            dates={days.map((d) => d.date)}
            xFormat={hourly ? "raw" : "date"}
            kind="number"
            series={[
              { name: "Sessions", color: "var(--s1)", values: days.map((d) => d.sessions), area: true },
              { name: "Visitors", color: "var(--s2)", values: days.map((d) => d.visitors) },
            ]}
          />
          <TableToggle>
            <DataTable
              nameLabel="Date"
              defaultSort="name"
              columns={[
                { key: "sessions", label: "Sessions" },
                { key: "visitors", label: "Visitors" },
                { key: "conversions", label: "Purchases" },
                { key: "rate", label: "Conv. rate", kind: "pct" },
              ]}
              rows={days.map((d) => ({ id: d.date, name: d.date, values: { sessions: d.sessions, visitors: d.visitors, conversions: d.conversions, rate: d.conversionRate } }))}
            />
          </TableToggle>
        </Card>
      </div>

      <ShopifyComparison mode={mode} range={f.range} ours={k} />

      <Card title="Breakdown" sub="Sessions and conversion by dimension. Click a column to sort.">
        <div className={s.chips} role="tablist" aria-label="Break down by">
          {DIMS.map((d) => (
            <Link key={d} href={`/dashboard/sessions${filterQuery(f, { dim: d === "channel" ? null : d })}`} className={`${s.chip} ${d === dim ? s.chipOn : ""}`} scroll={false} role="tab" aria-selected={d === dim}>
              {DIMENSION_LABELS[d]}
            </Link>
          ))}
        </div>
        <DataTable
          nameLabel={DIMENSION_LABELS[dim]}
          defaultSort="sessions"
          empty="No sessions in this range."
          columns={[
            { key: "sessions", label: "Sessions" },
            { key: "share", label: "Share", kind: "pct" },
            { key: "visitors", label: "Visitors" },
            { key: "bounce", label: "Bounce", kind: "pct" },
            { key: "atc", label: "Add to cart", kind: "pct" },
            { key: "conv", label: "Conv. rate", kind: "pct", target: k.conversionRate ? { value: k.conversionRate, better: "gte" } : undefined },
            { key: "conversions", label: "Purchases" },
          ]}
          rows={rows.map((r) => ({ id: r.key, name: r.label, values: { sessions: r.sessions, share: r.share, visitors: r.visitors, bounce: r.bounceRate, atc: r.addToCartRate, conv: r.conversionRate, conversions: r.conversions } }))}
        />
        <p className={s.cardSub} style={{ marginTop: 10 }}>Green/red conversion rates compare against your overall {pct(k.conversionRate, 2)}.</p>
      </Card>
    </>
  );
}
