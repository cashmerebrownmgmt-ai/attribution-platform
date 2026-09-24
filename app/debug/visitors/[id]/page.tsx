import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/debug";
import { loadVisitor } from "@/lib/debug-data";
import s from "../../debug.module.css";
import { MethodChip, sourceText, time } from "../../format";

export default async function VisitorPage({ params }: PageProps<"/debug/visitors/[id]">) {
  const { id } = await params;
  const data = await loadVisitor(id);
  if (!data) notFound();
  const { visitor, events, orders } = data;
  // first_touch has nulls stripped, so any field may be missing.
  const firstTouch = visitor.first_touch as Partial<Parameters<typeof sourceText>[0]> | null;
  const sessions = new Set(events.map((e) => e.session_id).filter(Boolean)).size;

  return (
    <>
      <h1 className={s.h1}>Visitor {visitor.id.slice(0, 8)}…</h1>
      <p className={s.sub}>
        First seen {time(visitor.first_seen_at)} · last seen {time(visitor.last_seen_at)}
      </p>

      <div className={s.grid}>
        <div className={s.card}>
          <div className={s.label}>First touch</div>
          <div className={s.note} style={{ fontSize: 14 }}>
            {firstTouch ? sourceText({ utm_source: null, utm_medium: null, referrer: null, ...firstTouch }) : "Direct / unknown"}
          </div>
        </div>
        <div className={s.card}>
          <div className={s.label}>Sessions</div>
          <div className={s.value}>{sessions}</div>
        </div>
        <div className={s.card}>
          <div className={s.label}>Events</div>
          <div className={s.value}>{events.length}</div>
        </div>
        <div className={s.card}>
          <div className={s.label}>Orders</div>
          <div className={s.value}>{orders.length}</div>
        </div>
      </div>

      {orders.length > 0 && (
        <section className={s.section}>
          <h2 className={s.h2}>Orders</h2>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Total</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/debug/orders/${o.id}`}>{o.name ?? o.id}</Link>
                    </td>
                    <td>{time(o.created_at)}</td>
                    <td>{formatMoney(o.total_price, o.currency)}</td>
                    <td>
                      <MethodChip method={o.stitch_method} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={s.section}>
        <h2 className={s.h2}>Activity (newest first)</h2>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Session</th>
                <th>Source</th>
                <th>Page</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{time(e.occurred_at)}</td>
                  <td>
                    {e.type}
                    {e.source === "pixel" && <span className={s.muted}> · checkout</span>}
                  </td>
                  <td className={s.muted}>{e.session_id?.slice(0, 8) ?? "—"}</td>
                  <td className={e.is_touchpoint ? undefined : s.muted}>{sourceText(e)}</td>
                  <td className={s.wrap}>{e.path ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
