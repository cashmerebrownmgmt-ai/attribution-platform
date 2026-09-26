import s from "./debug.module.css";
import { formatStoreTime } from "@/lib/tz";
import { CHANNEL_LABELS, METHOD_LABELS } from "@/lib/debug";

export function time(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatStoreTime(iso, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

export function MethodChip({ method }: { method: string }) {
  const cls = method === "none" ? s.bad : method === "customer_history" ? s.warn : s.good;
  return <span className={`${s.chip} ${cls}`}>{METHOD_LABELS[method] ?? method}</span>;
}

export function ChannelChip({ channel }: { channel: string }) {
  return <span className={s.chip}>{CHANNEL_LABELS[channel] ?? channel}</span>;
}

/** The marketing source of an event, in one short line. */
export function sourceText(e: {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign?: string | null;
  referrer: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  ttclid?: string | null;
  msclkid?: string | null;
}): string {
  const parts = [
    e.utm_source && `${e.utm_source}${e.utm_medium ? ` / ${e.utm_medium}` : ""}`,
    e.utm_campaign && `campaign: ${e.utm_campaign}`,
    e.gclid && "gclid",
    e.fbclid && "fbclid",
    e.ttclid && "ttclid",
    e.msclkid && "msclkid",
    !e.utm_source && e.referrer && `from ${safeHost(e.referrer)}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
