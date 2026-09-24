import Link from "next/link";
import { CHANNEL_LABELS } from "@/lib/debug";
import { money, num, pct } from "@/lib/dashboard/format";
import { loadPage } from "@/lib/dashboard/page";
import { ordersIn, timeToPurchase, topPaths, touchFlows } from "@/lib/metrics/compute";
import s from "../dashboard.module.css";
import { Columns } from "../_components/charts/Columns";
import { Sankey } from "../_components/charts/Sankey";
import { DataTable } from "../_components/DataTable";
import { Card, Filters, PageHead, TableToggle } from "../_components/ui";

export default async function JourneysPage({ searchParams }: PageProps<"/dashboard/journeys">) {
  const { mode, data, filters: f } = await loadPage(searchParams);
  const cur = data.settings.currency;
  const flows = touchFlows(data, f);
  const paths = topPaths(data, f, 12);
  const ttp = timeToPurchase(data, f);
  const orders = ordersIn(data, f.range);
  const multiTouch = orders.filter((o) => o.touches.first_touch.channel !== o.touches.last_non_direct.channel).length;
  const stitched = orders.filter((o) => o.stitchMethod !== "none").length;

  return (
    <>
      <PageHead
        title="Customer journeys"
        subtitle="How people find you before they buy"
        mode={mode}
        action={mode === "live" ? <Link className={s.button} href="/debug">Order explorer</Link> : undefined}
      />
      <Filters f={f} />

      <div className={s.kpiGrid}>
        <div className={s.card}>
          <div className={s.kpiLabel}>Orders with a known journey</div>
          <div className={s.kpiValue}>{pct(orders.length ? stitched / orders.length : null, 0)}</div>
          <div className={s.kpiTarget}>{num(stitched)} of {num(orders.length)} orders matched to a visitor</div>
        </div>
        <div className={s.card}>
          <div className={s.kpiLabel}>Started on a different channel</div>
          <div className={s.kpiValue}>{pct(orders.length ? multiTouch / orders.length : null, 0)}</div>
          <div className={s.kpiTarget}>First touch ≠ last non-direct touch</div>
        </div>
        <div className={s.card}>
          <div className={s.kpiLabel}>Bought within 3 days</div>
          <div className={s.kpiValue}>{pct(stitched ? (ttp[0].orders + ttp[1].orders) / Math.max(1, ttp.reduce((t, b) => t + b.orders, 0)) : null, 0)}</div>
          <div className={s.kpiTarget}>Of matched orders</div>
        </div>
      </div>

      <div className={s.stack}>
        <Card title="Where journeys start → what closed the sale" sub="First touch (left) to last non-direct touch (right). Hover to focus a flow.">
          {flows.length === 0 ? (
            <div className={s.empty}>No matched orders in this range.</div>
          ) : (
            <>
              <Sankey label="Flow from first touch to last non-direct touch" flows={flows} labels={CHANNEL_LABELS} leftTitle="First touch" rightTitle="Closed by" />
              <TableToggle>
                <DataTable
                  nameLabel="From → to"
                  defaultSort="orders"
                  columns={[{ key: "orders", label: "Orders" }]}
                  rows={flows.map((fl) => ({
                    id: `${fl.from}|${fl.to}`,
                    name: `${CHANNEL_LABELS[fl.from.split(":")[1]] ?? fl.from} → ${CHANNEL_LABELS[fl.to.split(":")[1]] ?? fl.to}`,
                    values: { orders: fl.orders },
                  }))}
                />
              </TableToggle>
            </>
          )}
        </Card>

        <div className={s.grid2} style={{ marginBottom: 0 }}>
          <Card title="Time to purchase" sub="From first visit in the lookback window to order">
            <Columns label="Orders by time to purchase" labels={ttp.map((b) => b.bucket)} series={[{ name: "Orders", color: "var(--s1)", values: ttp.map((b) => b.orders) }]} kind="number" />
          </Card>
          <Card title="Most common paths" sub="Channel sequence before purchase">
            <DataTable
              nameLabel="Path"
              currency={cur}
              defaultSort="orders"
              columns={[
                { key: "orders", label: "Orders" },
                { key: "revenue", label: "Revenue", kind: "money" },
              ]}
              rows={paths.map((p) => ({ id: p.path.join(">"), name: p.path.map((c) => CHANNEL_LABELS[c] ?? c).join(" → "), values: { orders: p.orders, revenue: p.revenue } }))}
            />
          </Card>
        </div>
      </div>
      <p className={s.cardSub} style={{ marginTop: 16 }}>
        Revenue in this range: {money(orders.reduce((t, o) => t + o.revenue, 0), cur)}
      </p>
    </>
  );
}
