import { CHANNEL_LABELS } from "@/lib/debug";
import { money, num, pct } from "@/lib/dashboard/format";
import { loadPage } from "@/lib/dashboard/page";
import { cohorts, ltvByChannel } from "@/lib/metrics/customers";
import s from "../dashboard.module.css";
import { BarList } from "../_components/charts/BarList";
import { DataTable } from "../_components/DataTable";
import { Card, PageHead } from "../_components/ui";

const asOfMs = (iso: string) => Date.parse(iso);

export default async function CustomersPage({ searchParams }: PageProps<"/dashboard/customers">) {
  const { mode, data } = await loadPage(searchParams);
  const cur = data.settings.currency;
  const asOf = asOfMs(data.generatedAt);
  const to = data.generatedAt.slice(0, 10);
  const from = new Date(asOf - 365 * 86_400_000).toISOString().slice(0, 10);
  const ltv = ltvByChannel(data, from, to, asOf);
  const all = ltv[0];
  const byChannel = ltv.slice(1).filter((r) => r.customers >= 5);
  const cohortRows = cohorts(data, 6, asOf);

  return (
    <>
      <PageHead title="Customers" subtitle="Repeat purchases and lifetime value by the channel that first brought each customer in" mode={mode} />

      {all.customers === 0 && <div className={s.callout}>Customer history builds as orders come in. Run the order import to include past customers.</div>}

      <div className={s.kpiGrid}>
        {[
          ["Customers (12 months)", num(all.customers)],
          ["First order value", money(all.firstOrderValue, cur, { cents: true })],
          ["90-day value", money(all.ltv90, cur, { cents: true })],
          ["Spend per customer to date", money(all.ltvAll, cur, { cents: true })],
          ["Buy again within 90 days", pct(all.repeatRate90, 1)],
          ["Orders per customer", all.ordersPerCustomer?.toFixed(2) ?? "—"],
          ["Median days to 2nd order", all.daysToSecond === null ? "—" : `${Math.round(all.daysToSecond)} days`],
        ].map(([label, value]) => (
          <div key={label} className={s.card}>
            <div className={s.kpiLabel}>{label}</div>
            <div className={s.kpiValue}>{value}</div>
          </div>
        ))}
      </div>

      <div className={s.grid2}>
        <Card title="90-day customer value by first channel" sub="What a customer is worth 90 days after their first order">
          {byChannel.length === 0 ? (
            <div className={s.empty}>Not enough customers yet.</div>
          ) : (
            <BarList label="90-day value by channel" kind="money" currency={cur} items={byChannel.filter((r) => r.ltv90 !== null).map((r) => ({ key: String(r.channel), label: CHANNEL_LABELS[r.channel as string] ?? String(r.channel), value: r.ltv90, note: `${num(r.customers)} customers · ${pct(r.repeatRate90, 0)} buy again` }))} />
          )}
          <p className={s.cardSub} style={{ marginTop: 8 }}>Use this to set channel targets: a channel whose customers are worth 2× more can afford 2× the cost per first purchase.</p>
        </Card>
        <Card title="By first channel" sub="Only customers old enough for each window count toward it">
          <DataTable
            nameLabel="First channel"
            currency={cur}
            defaultSort="customers"
            empty="Not enough customers yet."
            columns={[
              { key: "customers", label: "Customers" },
              { key: "first", label: "1st order", kind: "money" },
              { key: "ltv30", label: "30-day", kind: "money" },
              { key: "ltv90", label: "90-day", kind: "money" },
              { key: "repeat", label: "Repeat 90d", kind: "pct" },
              { key: "orders", label: "Orders/cust.", kind: "roas" },
            ]}
            rows={byChannel.map((r) => ({ id: String(r.channel), name: CHANNEL_LABELS[r.channel as string] ?? String(r.channel), values: { customers: r.customers, first: r.firstOrderValue, ltv30: r.ltv30, ltv90: r.ltv90, repeat: r.repeatRate90, orders: r.ordersPerCustomer } }))}
          />
        </Card>
      </div>

      <Card title="Monthly cohorts" sub="Of customers whose first order was in each month: share who bought again in month N, and cumulative revenue per customer">
        {cohortRows.length === 0 ? (
          <div className={s.empty}>Not enough history yet.</div>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>First order</th>
                  <th>Customers</th>
                  {cohortRows[0].retention.map((_, k) => (
                    <th key={k}>Month {k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohortRows.map((c) => (
                  <tr key={c.month}>
                    <td>{new Date(`${c.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}</td>
                    <td>{num(c.customers)}</td>
                    {c.retention.map((r, k) => (
                      <td key={k} style={r === null ? undefined : { background: `rgba(42, 120, 214, ${Math.min(0.55, (r ?? 0) * 3)})` }} title={c.revenuePerCustomer[k] === null ? "" : `${money(c.revenuePerCustomer[k], cur, { cents: true })} per customer so far`}>
                        {r === null ? "" : pct(r, 1)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={s.cardSub} style={{ marginTop: 8 }}>Hover a cell for cumulative revenue per customer. Month 0 counts customers who ordered twice in their first month.</p>
      </Card>
    </>
  );
}
