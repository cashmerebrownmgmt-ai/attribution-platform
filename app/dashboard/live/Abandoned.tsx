import Link from "next/link";
import { buildAbandonment, STEP_LABELS } from "@/lib/abandonment";
import { loadPixelSteps, loadShopifyAbandoned } from "@/lib/abandonment-data";
import { money, pct } from "@/lib/dashboard/format";
import { addDays } from "@/lib/metrics/compute";
import { sessionsIn } from "@/lib/sessions";
import { loadSessions } from "@/lib/sessions-data";
import { isLandingSite } from "@/lib/store-hosts";
import { formatStoreTime, storeDay } from "@/lib/tz";
import s from "../dashboard.module.css";
import { Card } from "../_components/ui";

export type AbandonedRange = "today" | "yesterday" | "7d";
export const ABANDONED_RANGES: { id: AbandonedRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
];

const when = (iso: string) => formatStoreTime(iso, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export async function Abandoned({ mode, range, now }: { mode: "live" | "demo"; range: AbandonedRange; now: number }) {
  const today = storeDay(now);
  const r = range === "today" ? { from: today, to: today } : range === "yesterday" ? { from: addDays(today, -1), to: addDays(today, -1) } : { from: addDays(today, -6), to: today };
  const facts = sessionsIn(await loadSessions(mode, r, today), r);
  const [pixel, shopifyAll] = await Promise.all([loadPixelSteps(mode, r, facts), loadShopifyAbandoned(mode, r, facts)]);
  const shopify = (shopifyAll ?? []).filter((x) => storeDay(x.createdAt) >= r.from && storeDay(x.createdAt) <= r.to);
  const a = buildAbandonment({ sessions: facts, pixel, shopify, now });
  const max = Math.max(1, a.funnel[0].count);

  return (
    <>
      <div className={s.chips} role="tablist" aria-label="Period" style={{ marginBottom: 12 }}>
        {ABANDONED_RANGES.map((x) => (
          <Link key={x.id} href={`/dashboard/live?tab=abandoned${x.id === "today" ? "" : `&range=${x.id}`}`} className={`${s.chip} ${x.id === range ? s.chipOn : ""}`} role="tab" aria-selected={x.id === range} scroll={false}>
            {x.label}
          </Link>
        ))}
      </div>

      <div className={s.kpiGrid}>
        {[
          ["Abandoned carts", String(a.abandonedCarts), "Added to cart, never started checkout"],
          ["Abandoned checkouts", String(a.abandonedCheckouts), "Started checkout, didn't buy"],
          ["Cart abandonment", pct(a.cartAbandonRate, 0), "Of visits that added to cart"],
          ["Checkout abandonment", pct(a.checkoutAbandonRate, 0), "Of visits that started checkout"],
          ["Left in checkouts", shopifyAll === null ? "—" : money(a.valueLeft, a.currency), shopifyAll === null ? "Shopify unavailable" : `${shopify.length} abandoned checkout${shopify.length === 1 ? "" : "s"} (Shopify)`],
          ["Bounce rate", pct(a.bounceRate, 0), "One page, then left"],
        ].map(([label, value, foot]) => (
          <div key={label} className={s.card}>
            <div className={s.kpiLabel}>{label}</div>
            <div className={s.kpiValue}>{value}</div>
            <div className={s.kpiTarget}>{foot}</div>
          </div>
        ))}
      </div>

      <div className={s.grid2}>
        <Card title="Where people drop off" sub="Visits reaching each step, and the share of the step before that continued">
          <div className={s.funnel}>
            {a.funnel.map((f, i) => (
              <div key={f.step} className={s.funnelRow}>
                <div className={s.funnelLabel}>
                  <b>{f.label}</b>
                  <span className={s.muted}>
                    {f.count}
                    {f.fromPrevious !== null ? ` · ${pct(f.fromPrevious, 0)} continued` : ""}
                  </span>
                </div>
                <div className={s.funnelTrack}>
                  <span className={s.growX} style={{ width: `${(f.count / max) * 100}%` }} />
                </div>
                {i > 0 && f.fromPrevious !== null && f.fromPrevious < 1 && <div className={s.funnelDrop}>{pct(1 - f.fromPrevious, 0)} dropped off</div>}
              </div>
            ))}
          </div>
        </Card>
        <Card title="Bounce rate by site" sub="Visits that saw one page and left without adding to cart">
          {a.bounceBySite.length === 0 ? (
            <div className={s.empty}>No visits in this period.</div>
          ) : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>Visits</th>
                    <th>Bounce rate</th>
                  </tr>
                </thead>
                <tbody>
                  {a.bounceBySite.map((b) => (
                    <tr key={b.site}>
                      <td>
                        {b.site}
                        {isLandingSite(b.site) ? <span className={s.muted}> · landing page</span> : null}
                      </td>
                      <td>{b.sessions}</td>
                      <td>{pct(b.bounceRate, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title={`Abandoned visits (${a.rows.length})`} sub={`Idle 30+ minutes without buying. ${a.stillActive ? `${a.stillActive} still shopping aren't counted yet.` : ""} Value and products come from Shopify when a checkout matches by time (likely match).`}>
        {a.rows.length === 0 ? (
          <div className={s.empty}>No abandoned carts or checkouts in this period.</div>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Last active</th>
                  <th>Got to</th>
                  <th>From</th>
                  <th>Site</th>
                  <th>Where</th>
                  <th>Cart</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {a.rows.map((x) => (
                  <tr key={x.key}>
                    <td>{when(x.lastActiveAt)}</td>
                    <td className={x.kind === "checkout" ? s.warnText : undefined}>{STEP_LABELS[x.furthest]}</td>
                    <td>{x.source}</td>
                    <td>{x.site ?? "—"}</td>
                    <td>
                      {[x.location.city, x.location.country].filter(Boolean).join(", ") || "—"}
                      {x.device ? <span className={s.muted}> · {x.device}</span> : null}
                    </td>
                    <td>{x.match ? `${money(x.match.value, x.match.currency, { cents: true })} · ${x.match.items.join(", ")}` : "—"}</td>
                    <td>{mode === "live" ? <Link href={`/debug/visitors/${x.visitorId}`}>Journey ›</Link> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div style={{ height: 12 }} />

      <Card title="Shopify's abandoned checkouts" sub="Checkouts where the buyer entered contact details but didn't pay. Win these back with Shopify's abandoned-checkout email (Settings → Notifications).">
        {shopifyAll === null ? (
          <div className={s.empty}>Couldn&apos;t reach Shopify right now.</div>
        ) : a.shopify.length === 0 ? (
          <div className={s.empty}>None in this period.</div>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Value</th>
                  <th>Products</th>
                  <th>Matched visit</th>
                </tr>
              </thead>
              <tbody>
                {a.shopify.map((x) => (
                  <tr key={x.id}>
                    <td>{when(x.createdAt)}</td>
                    <td>{money(x.value, x.currency, { cents: true })}</td>
                    <td>{x.items.join(", ")}</td>
                    <td className={s.muted}>{x.matchedKey ? "Yes (likely)" : "Not tracked"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
