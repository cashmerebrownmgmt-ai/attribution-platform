import Link from "next/link";
import { redirect } from "next/navigation";
import { formatMoney, formatPercent, matchStats, parseSearch } from "@/lib/debug";
import { loadOverview, resolveSearch } from "@/lib/debug-data";
import s from "./debug.module.css";
import { MethodChip, time } from "./format";

const DAY = 24 * 60 * 60 * 1000;

export default async function DebugHome({ searchParams }: PageProps<"/debug">) {
  const q = (await searchParams).q;
  const query = Array.isArray(q) ? q[0] : q;
  let notFound = false;
  if (query) {
    const href = await resolveSearch(parseSearch(query));
    if (href) redirect(href);
    notFound = true;
  }

  const now = new Date();
  const data = await loadOverview(now);
  const week = matchStats(data.statsOrders, new Date(now.getTime() - 7 * DAY));
  const month = matchStats(data.statsOrders, new Date(now.getTime() - 30 * DAY));
  const lastEventAgeMin = data.lastEvent ? (now.getTime() - Date.parse(data.lastEvent.received_at)) / 60000 : null;
  const failing = data.webhooks.filter((w) => w.error).length;

  return (
    <>
      {notFound && (
        <div className={`${s.alert} ${s.warn}`}>
          Nothing found for <strong>{query}</strong>. Try an order number like #1001, a visitor ID or a checkout token.
        </div>
      )}
      <h1 className={s.h1}>Overview</h1>
      <p className={s.sub}>Tracking health and the latest orders. Times are shown in your browser&apos;s time zone.</p>

      <div className={s.grid}>
        <div className={s.card}>
          <div className={s.label}>Match rate · 7 days</div>
          <div className={s.value}>{formatPercent(week.rate)}</div>
          <div className={s.note}>
            {week.matched} of {week.total} orders linked to a visitor
          </div>
        </div>
        <div className={s.card}>
          <div className={s.label}>Match rate · 30 days</div>
          <div className={s.value}>{formatPercent(month.rate)}</div>
          <div className={s.note}>
            {month.matched} of {month.total} orders
          </div>
        </div>
        <div className={s.card}>
          <div className={s.label}>Events · last 24h</div>
          <div className={s.value}>{data.events24h.toLocaleString()}</div>
          <div className={`${s.note} ${lastEventAgeMin === null || lastEventAgeMin > 60 ? s.warn : s.good}`}>
            {lastEventAgeMin === null
              ? "No events received yet"
              : `Last event ${lastEventAgeMin < 1 ? "just now" : `${Math.round(lastEventAgeMin)} min ago`} (${data.lastEvent?.source})`}
          </div>
        </div>
        <div className={s.card}>
          <div className={s.label}>Visitors tracked</div>
          <div className={s.value}>{data.visitorCount.toLocaleString()}</div>
          <div className={`${s.note} ${failing ? s.bad : ""}`}>
            {failing ? `${failing} failed webhook${failing > 1 ? "s" : ""} below` : "No webhook failures"}
          </div>
        </div>
      </div>

      <section className={s.section}>
        <h2 className={s.h2}>Recent orders</h2>
        <div className={s.tableWrap}>
          {data.recentOrders.length === 0 ? (
            <div className={s.empty}>No orders yet. They appear here once Shopify webhooks are connected.</div>
          ) : (
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/debug/orders/${o.id}`}>{o.name ?? o.id}</Link>
                    </td>
                    <td>{time(o.created_at)}</td>
                    <td>{formatMoney(o.total_price, o.currency)}</td>
                    <td className={s.muted}>{o.financial_status ?? "—"}</td>
                    <td>
                      <MethodChip method={o.stitch_method} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className={s.section}>
        <h2 className={s.h2}>Recent webhooks</h2>
        <div className={s.tableWrap}>
          {data.webhooks.length === 0 ? (
            <div className={s.empty}>No webhooks received yet.</div>
          ) : (
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Received</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {data.webhooks.map((w) => (
                  <tr key={w.webhook_id}>
                    <td>{w.topic}</td>
                    <td>{time(w.received_at)}</td>
                    <td className={`${s.wrap} ${w.error ? s.bad : w.processed_at ? s.good : s.warn}`}>
                      {w.error ? `Failed: ${w.error}` : w.processed_at ? "Processed" : "Pending"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
