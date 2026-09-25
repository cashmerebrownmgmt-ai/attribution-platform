import { num, pct, signedPct } from "@/lib/dashboard/format";
import { loadPage } from "@/lib/dashboard/page";
import { todayUtc } from "@/lib/dashboard/data";
import { daysIn } from "@/lib/metrics/compute";
import { productPerformance } from "@/lib/metrics/products";
import { dimensionValue, previousSessionRange, sessionKpis, sessionsIn, type SessionFact } from "@/lib/sessions";
import { loadSessions } from "@/lib/sessions-data";
import { falling, lowCartProducts, movers, overallScale, rising, searchMatches, totals, trendTips, type Mover } from "@/lib/trends";
import { loadPageStats } from "@/lib/trends-data";
import s from "../dashboard.module.css";
import { DataTable } from "../_components/DataTable";
import { Tips } from "../_components/Tips";
import { Card, Filters, PageHead } from "../_components/ui";

const STATUS: Record<Mover["status"], string> = { new: "New", rising: "Rising", falling: "Falling", steady: "Steady" };

function countBy(facts: SessionFact[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of facts) {
    const k = dimensionValue(f, "source");
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function MoverTable({ rows, label, unit, empty, extra }: { rows: Mover[]; label: string; unit: string; empty: string; extra?: (m: Mover) => string }) {
  return (
    <DataTable
      nameLabel={label}
      defaultSort="z"
      empty={empty}
      columns={[
        { key: "current", label: unit },
        { key: "previous", label: "Before" },
        { key: "change", label: "Change", kind: "text" },
        { key: "status", label: "Trend", kind: "text" },
        ...(extra ? [{ key: "extra", label: "Note", kind: "text" as const }] : []),
        { key: "z", label: "Strength", kind: "score" },
      ]}
      rows={rows.map((m) => ({
        id: m.key,
        name: m.label,
        values: { current: m.current, previous: m.previous, change: m.change === null ? "new" : signedPct(m.change), status: STATUS[m.status], extra: extra?.(m) ?? "", z: Math.abs(m.z) },
      }))}
    />
  );
}

export default async function TrendsPage({ searchParams }: PageProps<"/dashboard/trends">) {
  const { mode, data, filters: f } = await loadPage(searchParams);
  const today = todayUtc();
  const prevRange = previousSessionRange(f.range);
  const [stats, facts] = await Promise.all([loadPageStats(mode, f.range, today), loadSessions(mode, f.range, today)]);

  const curFacts = sessionsIn(facts, f.range);
  const prevFacts = sessionsIn(facts, prevRange);
  // Each list is judged against its own total (sources against all traffic), so a busy month doesn't make every row "rising".
  const traffic = prevFacts.length > 0 && curFacts.length > 0 ? curFacts.length / prevFacts.length : 1;

  const sessionsOf = (m: Map<string, { sessions: number }>) => new Map([...m].map(([k, v]) => [k, v.sessions]));
  const labelsOf = (m: Map<string, { label: string }>) => new Map([...m].map(([k, v]) => [k, v.label]));

  const prodCur = totals(stats, "product", f.range);
  const prodPrev = totals(stats, "product", prevRange);
  const productMovers = movers(sessionsOf(prodCur), sessionsOf(prodPrev), new Map([...labelsOf(prodPrev), ...labelsOf(prodCur)]), 10, overallScale(sessionsOf(prodCur), sessionsOf(prodPrev)));

  const colCur = totals(stats, "collection", f.range);
  const colPrev = totals(stats, "collection", prevRange);
  const collectionMovers = movers(sessionsOf(colCur), sessionsOf(colPrev), new Map([...labelsOf(colPrev), ...labelsOf(colCur)]), 10, overallScale(sessionsOf(colCur), sessionsOf(colPrev)));

  const searchCur = totals(stats, "search", f.range);
  const searchPrev = totals(stats, "search", prevRange);
  const searchMovers = movers(sessionsOf(searchCur), sessionsOf(searchPrev), new Map(), 5, overallScale(sessionsOf(searchCur), sessionsOf(searchPrev)));
  const catalog = [...new Set([...prodCur.values(), ...prodPrev.values()].flatMap((p) => [p.key, p.label]).concat(data.orders.flatMap((o) => o.items.map((i) => i.title))))];
  const unmatched = new Set(searchMovers.filter((m) => !searchMatches(m.key, catalog)).map((m) => m.key));

  const sourceMovers = movers(countBy(curFacts), countBy(prevFacts), new Map(), 20, traffic);

  const salesCur = productPerformance(data, f.range, "last_touch");
  const salesPrev = productPerformance(data, prevRange, "last_touch");
  const unitsCur = new Map(salesCur.map((p) => [p.key, p.units]));
  const unitsPrev = new Map(salesPrev.map((p) => [p.key, p.units]));
  const salesMovers = movers(unitsCur, unitsPrev, new Map([...salesPrev, ...salesCur].map((p) => [p.key, p.title])), 5, overallScale(unitsCur, unitsPrev));

  const lowCart = lowCartProducts([...prodCur.values()]);
  const tips = trendTips({
    products: productMovers,
    searches: searchMovers,
    unmatched,
    lowCart,
    sources: sourceMovers,
    days: daysIn(f.range).length,
    conversionRate: sessionKpis(curFacts).conversionRate ?? 0.02,
  });

  const noData = mode === "live" && prodCur.size === 0 && searchCur.size === 0;
  const movingFirst = (ms: Mover[]) => [...rising(ms), ...falling(ms), ...ms.filter((m) => m.status === "steady")];

  return (
    <>
      <PageHead title="Trend radar" subtitle="What's picking up or fading on your store, compared with the period before" mode={mode} />
      <Filters f={f} showPlatform={false} showModel={false} />

      {noData && <div className={s.callout}>Trends build from product views and on-site searches as visitors browse. Give it a week of traffic for the first comparisons.</div>}

      {traffic !== 1 && (
        <p className={s.cardSub} style={{ margin: "0 0 10px" }}>
          Overall traffic changed {signedPct(traffic - 1)} vs the period before. In each list, rising and falling mean growing faster or slower than the rest of that list.
        </p>
      )}
      <Card title="What to act on" sub="From changes big enough not to be noise. Ranked by estimated extra orders.">
        <Tips tips={tips} />
      </Card>
      <div style={{ height: 12 }} />

      <div className={s.grid2}>
        <Card title="Product interest" sub="Sessions that viewed each product page">
          <MoverTable rows={movingFirst(productMovers)} label="Product" unit="Sessions" empty="No product views yet." extra={(m) => { const t = prodCur.get(m.key); return t && t.sessions ? `${pct(t.carts / t.sessions, 0)} add to cart` : ""; }} />
        </Card>
        <Card title="On-site searches" sub="What visitors type into your store's search. “No product” means nothing you sell matches the words.">
          <MoverTable rows={movingFirst(searchMovers)} label="Search" unit="Searches" empty="No searches yet. Searches show up once visitors use your store's search bar." extra={(m) => (unmatched.has(m.key) ? "No product" : "")} />
        </Card>
      </div>

      <div className={s.grid2}>
        <Card title="Units sold" sub="From Shopify orders with product details">
          <MoverTable rows={movingFirst(salesMovers)} label="Product" unit="Units" empty="No product sales in these periods yet." />
        </Card>
        <Card title="Traffic sources" sub="Sessions by source">
          <MoverTable rows={movingFirst(sourceMovers)} label="Source" unit="Sessions" empty="Not enough sessions yet." />
        </Card>
      </div>

      <Card title="Collections" sub="Sessions that viewed each collection page">
        <MoverTable rows={movingFirst(collectionMovers)} label="Collection" unit="Sessions" empty="No collection views yet." />
      </Card>

      <p className={s.cardSub} style={{ marginTop: 10 }}>
        Strength is how far the change is from normal day-to-day noise, after allowing for the change in the whole list: 2 or more is a real move. Items need at least a handful of sessions to be compared. {num(curFacts.length)} sessions in this range.
        Coming next: rising “type beat” artists on YouTube and a weekly AI summary of your niche, once their keys are added.
      </p>
    </>
  );
}
