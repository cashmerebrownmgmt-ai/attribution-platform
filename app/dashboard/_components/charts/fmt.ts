import { money, num, pct, roas } from "@/lib/dashboard/format";

/** Value formats that can cross the server → client boundary (functions can't). */
export type ValueKind = "money" | "number" | "roas" | "pct" | "score";

export function fmt(kind: ValueKind, n: number | null, currency = "USD", compact = false): string {
  switch (kind) {
    case "money":
      return money(n, currency, { compact });
    case "roas":
      return roas(n);
    case "pct":
      return pct(n);
    case "score":
      return n === null || !Number.isFinite(n) ? "—" : n.toFixed(1);
    default:
      return num(n, compact);
  }
}
