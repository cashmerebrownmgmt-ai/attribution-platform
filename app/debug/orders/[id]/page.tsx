import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/debug";
import { loadOrder } from "@/lib/debug-data";
import s from "../../debug.module.css";
import { ChannelChip, MethodChip, sourceText, time } from "../../format";

const MODEL_LABELS: Record<string, string> = {
  first_touch: "First touch",
  last_touch: "Last touch",
  last_non_direct: "Last non-direct",
};
const MODEL_ORDER = ["first_touch", "last_touch", "last_non_direct"];

type AttributionView = {
  model: string;
  channel: string;
  event_id: string | null;
  events: { occurred_at: string; path: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; referrer: string | null } | null;
};

export default async function OrderPage({ params }: PageProps<"/debug/orders/[id]">) {
  const { id } = await params;
  const data = await loadOrder(id);
  if (!data) notFound();
  const { order, timeline } = data;
  const attributions = (data.attributions as unknown as AttributionView[]).sort(
    (a, b) => MODEL_ORDER.indexOf(a.model) - MODEL_ORDER.indexOf(b.model),
  );
  const creditedEvents = new Set(attributions.map((a) => a.event_id).filter(Boolean));

  return (
    <>
      <h1 className={s.h1}>Order {order.name ?? order.id}</h1>
      <p className={s.sub}>
        Placed {time(order.created_at)} · {formatMoney(order.total_price, order.currency)} · {order.financial_status ?? "—"}
        {order.cancelled_at ? " · cancelled" : ""}
      </p>

      <div className={s.grid}>
        <div className={s.card}>
          <div className={s.label}>How it was matched</div>
          <div style={{ marginTop: 8 }}>
            <MethodChip method={order.stitch_method} />
          </div>
          <div className={s.note}>
            {order.visitor_id ? (
              <>
                Visitor <Link href={`/debug/visitors/${order.visitor_id}`}>{order.visitor_id.slice(0, 8)}…</Link>
              </>
            ) : (
              "No visitor found for this order"
            )}
          </div>
        </div>
        {attributions.map((a) => (
          <div key={a.model} className={s.card}>
            <div className={s.label}>{MODEL_LABELS[a.model] ?? a.model}</div>
            <div style={{ marginTop: 8 }}>
              <ChannelChip channel={a.channel} />
            </div>
            <div className={s.note}>{a.events ? `${sourceText(a.events)} · ${time(a.events.occurred_at)}` : "No marketing source"}</div>
          </div>
        ))}
      </div>

      <section className={s.section}>
        <h2 className={s.h2}>Journey (30 days before the order)</h2>
        <div className={s.tableWrap}>
          {timeline.length === 0 ? (
            <div className={s.empty}>No tracked activity for this order.</div>
          ) : (
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
                {timeline.map((e) => (
                  <tr key={e.id} className={creditedEvents.has(e.id) ? s.touch : undefined}>
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
          )}
        </div>
        <p className={s.note}>Rows with a blue edge are the touchpoints that received credit.</p>
      </section>

      <section className={s.section}>
        <h2 className={s.h2}>Shopify details</h2>
        <div className={s.card}>
          <dl className={s.kv}>
            <dt>Order ID</dt>
            <dd>{order.id}</dd>
            <dt>Checkout token</dt>
            <dd>{order.checkout_token ?? "—"}</dd>
            <dt>Landing page</dt>
            <dd>{order.landing_site ?? "—"}</dd>
            <dt>Shopify referrer</dt>
            <dd>{order.referring_site ?? "—"}</dd>
            <dt>Sales channel</dt>
            <dd>{order.source_name ?? "—"}</dd>
            <dt>Received via</dt>
            <dd>{order.ingested_via}</dd>
            <dt>Last updated</dt>
            <dd>{time(order.updated_at)}</dd>
          </dl>
        </div>
      </section>
    </>
  );
}
