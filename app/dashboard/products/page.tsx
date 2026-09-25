import { CHANNEL_LABELS } from "@/lib/debug";
import { PLATFORM_LABELS } from "@/lib/dashboard/filters";
import { money, num, pct } from "@/lib/dashboard/format";
import { loadPage } from "@/lib/dashboard/page";
import { boughtTogether, productPerformance } from "@/lib/metrics/products";
import s from "../dashboard.module.css";
import { BarList } from "../_components/charts/BarList";
import { DataTable } from "../_components/DataTable";
import { Card, Filters, PageHead } from "../_components/ui";

export default async function ProductsPage({ searchParams }: PageProps<"/dashboard/products">) {
  const { mode, data, filters: f } = await loadPage(searchParams);
  const cur = data.settings.currency;
  const rows = productPerformance(data, f.range, f.model);
  const pairs = boughtTogether(data, f.range);
  const hasItems = data.orders.some((o) => o.items.length > 0);

  return (
    <>
      <PageHead title="Products" subtitle="Which kits sell, to whom, and from which sources" mode={mode} />
      <Filters f={f} showPlatform={false} />
      {mode === "live" && !hasItems && (
        <div className={s.callout}>Product details appear for orders received from now on. Run the order import to add your past orders.</div>
      )}

      <div className={s.grid2}>
        <Card title="Revenue by product" sub="Top 12 in this range">
          {rows.length === 0 ? (
            <div className={s.empty}>No product sales in this range.</div>
          ) : (
            <BarList label="Revenue by product" kind="money" currency={cur} items={rows.slice(0, 12).map((r) => ({ key: r.key, label: r.title, value: r.revenue, note: `${num(r.units)} sold · ${pct(r.share, 0)}` }))} />
          )}
        </Card>
        <Card title="Bought together" sub="Pairs in the same order. Lift above 1× means more often than by chance: bundle them.">
          <DataTable
            nameLabel="Pair"
            defaultSort="orders"
            empty="Not enough multi-item orders yet."
            columns={[
              { key: "orders", label: "Orders" },
              { key: "lift", label: "Lift", kind: "roas" },
            ]}
            rows={pairs.map((p) => ({ id: `${p.a}|${p.b}`, name: `${p.a} + ${p.b}`, values: { orders: p.orders, lift: p.lift } }))}
          />
        </Card>
      </div>

      <Card title="All products" sub="Credit for the source follows the selected attribution model">
        <DataTable
          nameLabel="Product"
          currency={cur}
          defaultSort="revenue"
          empty="No product sales in this range."
          columns={[
            { key: "revenue", label: "Revenue", kind: "money" },
            { key: "share", label: "Share", kind: "pct" },
            { key: "units", label: "Units" },
            { key: "orders", label: "Orders" },
            { key: "avg", label: "Avg. price", kind: "money" },
            { key: "newShare", label: "New cust.", kind: "pct" },
            { key: "paid", label: "From ads", kind: "pct" },
            { key: "channel", label: "Top channel", kind: "text" },
            { key: "platform", label: "Top ad platform", kind: "text" },
          ]}
          rows={rows.map((r) => ({
            id: r.key,
            name: r.title,
            values: {
              revenue: r.revenue,
              share: r.share,
              units: r.units,
              orders: r.orders,
              avg: r.avgPrice,
              newShare: r.newCustomerShare,
              paid: r.paidShare,
              channel: r.topChannel ? CHANNEL_LABELS[r.topChannel] ?? r.topChannel : "—",
              platform: r.topPlatform ? PLATFORM_LABELS[r.topPlatform] : "—",
            },
          }))}
        />
      </Card>
      <p className={s.cardSub} style={{ marginTop: 10 }}>Revenue here is item price × quantity before order-level discounts, so it can differ slightly from order totals. {money(rows.reduce((t, r) => t + r.revenue, 0), cur)} in product revenue this range.</p>
    </>
  );
}
