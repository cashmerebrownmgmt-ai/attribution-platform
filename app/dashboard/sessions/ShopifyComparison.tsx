import { unstable_cache } from "next/cache";
import { num, pct } from "@/lib/dashboard/format";
import type { DateRange } from "@/lib/metrics/compute";
import type { SessionKpis } from "@/lib/sessions";
import { adminClient } from "@/lib/shopify-admin";
import { classifyError, parseTotals, Q_SHOPIFYQL, sessionsQuery, type ComparisonResult } from "@/lib/shopify-reports";
import s from "../dashboard.module.css";
import { Card } from "../_components/ui";

// Shopify's analytics refresh slowly; cache per date range for 10 minutes.
const fetchShopify = unstable_cache(
  async (from: string, to: string): Promise<ComparisonResult> => {
    const { SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } = process.env;
    if (!SHOPIFY_SHOP_DOMAIN || !SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) return { status: "not_configured" };
    try {
      const client = adminClient({ shop: SHOPIFY_SHOP_DOMAIN, clientId: SHOPIFY_CLIENT_ID, clientSecret: SHOPIFY_CLIENT_SECRET });
      const data = await client.graphql<{ shopifyqlQuery: { tableData: { columns: { name: string }[]; rows: unknown } | null; parseErrors: unknown } }>(Q_SHOPIFYQL, {
        query: sessionsQuery({ from, to }),
      });
      const errs = data.shopifyqlQuery.parseErrors;
      if (Array.isArray(errs) && errs.length) return { status: "error", message: JSON.stringify(errs).slice(0, 300) };
      const totals = parseTotals(data.shopifyqlQuery.tableData);
      return totals ? { status: "ok", totals } : { status: "error", message: "Shopify returned no rows" };
    } catch (e) {
      return classifyError(e instanceof Error ? e.message : String(e));
    }
  },
  ["shopify-sessions"],
  { revalidate: 600 },
);

function Row({ label, ours, theirs, kind }: { label: string; ours: number | null; theirs: number | null; kind: "num" | "pct" }) {
  const f = (v: number | null) => (kind === "pct" ? pct(v, 2) : num(v));
  const diff = ours !== null && theirs ? ours / theirs - 1 : null;
  return (
    <tr>
      <td>{label}</td>
      <td>{f(ours)}</td>
      <td>{f(theirs)}</td>
      <td className={s.muted}>{diff === null ? "—" : `${diff >= 0 ? "+" : "−"}${Math.abs(diff * 100).toFixed(0)}%`}</td>
    </tr>
  );
}

export async function ShopifyComparison({ mode, range, ours }: { mode: "live" | "demo"; range: DateRange; ours: SessionKpis }) {
  if (mode === "demo") {
    return (
      <div className={s.callout}>
        <strong>Compare with Shopify:</strong> in Live mode this section shows your tracking next to Shopify&apos;s own analytics for the same dates.
      </div>
    );
  }
  const res = await fetchShopify(range.from, range.to);
  if (res.status !== "ok") {
    return (
      <div className={s.callout} style={{ marginBottom: 12 }}>
        <strong>Compare with Shopify:</strong>{" "}
        {res.status === "not_configured"
          ? "connect Shopify (SHOPIFY_* settings) to compare with Shopify Analytics."
          : res.status === "no_access"
            ? "Shopify needs to grant this app analytics access first. In the Dev Dashboard add the read_reports scope in a new version, request protected customer data access, and approve the update in your Shopify admin."
            : `couldn't load Shopify's numbers right now (${res.message}).`}
      </div>
    );
  }
  const t = res.totals;
  return (
    <div style={{ marginBottom: 12 }}>
      <Card title="Our tracking vs Shopify Analytics" sub="Same date range. Shopify's numbers exclude bots and are refreshed every 10 minutes.">
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Our tracking</th>
                <th>Shopify</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Sessions" ours={ours.sessions} theirs={t.sessions} kind="num" />
              <Row label="Visitors" ours={ours.visitors} theirs={t.visitors} kind="num" />
              <Row label="Sessions with cart additions" ours={ours.funnel[1].sessions} theirs={t.cartAdditions} kind="num" />
              <Row label="Reached checkout" ours={ours.funnel[2].sessions} theirs={t.reachedCheckout} kind="num" />
              <Row label="Completed checkout" ours={ours.funnel[3].sessions} theirs={t.completedCheckout} kind="num" />
              <Row label="Conversion rate" ours={ours.conversionRate} theirs={t.conversionRate} kind="pct" />
            </tbody>
          </table>
        </div>
        <details className={s.tableToggle}>
          <summary>Why the numbers differ</summary>
          <ul className={s.reasons} style={{ marginTop: 8 }}>
            <li>We only count visitors who allow analytics cookies; Shopify counts all human sessions.</li>
            <li>Ad blockers can stop our script (and Shopify&apos;s own pixels) on some browsers.</li>
            <li>We start a new session when a visitor arrives from a new campaign; Shopify only splits on 30 minutes of inactivity.</li>
            <li>Our tracking started when the script was installed, so earlier dates are empty on our side.</li>
          </ul>
        </details>
      </Card>
    </div>
  );
}
