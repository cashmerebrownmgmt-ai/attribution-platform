/**
 * Single-touch attribution over a visitor's storefront sessions. Pure.
 * See docs/phase-1-spec.md §6.
 */
import { classifyChannel, type Channel } from "./channel";

export const LOOKBACK_DAYS = 30;
export const MODELS = ["first_touch", "last_touch", "last_non_direct"] as const;
export type Model = (typeof MODELS)[number];

export type TrackedEvent = {
  id: string;
  session_id: string | null;
  source: "tracker" | "pixel";
  occurred_at: string;
  is_touchpoint: boolean;
  utm_source: string | null;
  utm_medium: string | null;
  gclid: string | null;
  fbclid: string | null;
  ttclid: string | null;
  msclkid: string | null;
  referrer: string | null;
};

export type Attribution = { model: Model; event_id: string | null; channel: Channel; credit: number };

type Session = { at: number; touch: TrackedEvent | null };

/**
 * Group storefront events into sessions within the lookback window. A session's source is its
 * first touchpoint; a session with none is direct. Checkout (pixel) events never start a session.
 */
export function sessionsBefore(events: TrackedEvent[], orderAt: Date, lookbackDays = LOOKBACK_DAYS): Session[] {
  const end = orderAt.getTime();
  const start = end - lookbackDays * 24 * 60 * 60 * 1000;
  const bySession = new Map<string, Session>();
  const sorted = events
    .filter((e) => e.source === "tracker")
    .map((e) => ({ e, t: Date.parse(e.occurred_at) }))
    .filter(({ t }) => t >= start && t <= end)
    .sort((a, b) => a.t - b.t);

  for (const { e, t } of sorted) {
    const key = e.session_id ?? `event:${e.id}`;
    const s = bySession.get(key);
    if (!s) bySession.set(key, { at: t, touch: e.is_touchpoint ? e : null });
    else if (!s.touch && e.is_touchpoint) s.touch = e;
  }
  return [...bySession.values()].sort((a, b) => a.at - b.at);
}

function credit(model: Model, s: Session | undefined): Attribution {
  if (!s?.touch) return { model, event_id: null, channel: "direct", credit: 1 };
  return { model, event_id: s.touch.id, channel: classifyChannel(s.touch), credit: 1 };
}

export function attribute(events: TrackedEvent[], orderAt: Date, lookbackDays = LOOKBACK_DAYS): Attribution[] {
  const sessions = sessionsBefore(events, orderAt, lookbackDays);
  const withSource = sessions.filter((s) => s.touch);
  return [
    credit("first_touch", sessions[0]),
    credit("last_touch", sessions.at(-1)),
    credit("last_non_direct", withSource.at(-1)),
  ];
}
