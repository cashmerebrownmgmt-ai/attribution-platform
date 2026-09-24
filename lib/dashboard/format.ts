/** Number formatting for the dashboard. Pure. */

export function money(n: number | null, currency = "USD", opts: { compact?: boolean; cents?: boolean } = {}): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const compact = opts.compact && Math.abs(n) >= 10_000;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : opts.cents ? 2 : 0,
      minimumFractionDigits: compact ? 0 : opts.cents ? 2 : 0,
    }).format(n);
  } catch {
    return `${n.toFixed(opts.cents ? 2 : 0)} ${currency}`;
  }
}

export function num(n: number | null, compact = false): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: compact && Math.abs(n) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: compact && Math.abs(n) >= 10_000 ? 1 : 0,
  }).format(n);
}

export function pct(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function roas(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}

/** Signed relative change, e.g. "+12.4%". */
export function signedPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const v = (n * 100).toFixed(1);
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${v.replace("-", "")}%`;
}

export function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function longDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Nice" axis ticks from 0 to at least max. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}
