/**
 * Rule-based ad verdicts: the deterministic core the AI advisor (Phase 5) explains.
 * Every verdict carries the numbers behind it. See docs/roadmap.md § Phase 5.
 */
import type { PerfRow } from "./compute";
import type { Settings } from "./types";

export type Verdict = "scale" | "keep" | "watch" | "refresh" | "pause" | "learning";

export type Signal = { verdict: Verdict; headline: string; reasons: string[] };

export const VERDICT_LABELS: Record<Verdict, string> = {
  scale: "Scale",
  keep: "Keep running",
  watch: "Watch",
  refresh: "Refresh creative",
  pause: "Pause",
  learning: "Still learning",
};

type Input = {
  row: PerfRow;
  /** CTR change from early to recent weeks (negative = fatigue); null if too new. */
  ctrDecay: number | null;
  /** Days since launch, if known. */
  ageDays: number | null;
  settings: Pick<Settings, "targetRoas" | "targetCpa" | "breakevenRoas">;
};

const x = (n: number | null) => (n === null ? "—" : `${n.toFixed(2)}×`);
const pctText = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;

export function adSignal({ row, ctrDecay, ageDays, settings }: Input): Signal {
  const target = settings.targetRoas ?? 2;
  const breakeven = settings.breakevenRoas ?? 1;
  const targetCpa = settings.targetCpa ?? 40;
  const roas = row.roas;
  const minSpend = Math.max(100, targetCpa * 3);

  if ((ageDays !== null && ageDays < 7) || row.spend < minSpend) {
    return {
      verdict: "learning",
      headline: "Not enough data yet",
      reasons: [
        ageDays !== null && ageDays < 7 ? `Launched ${ageDays} day${ageDays === 1 ? "" : "s"} ago` : `Only ${Math.round(row.spend)} spent so far (need ~${Math.round(minSpend)})`,
        "Give it a few more days before judging it",
      ],
    };
  }

  if (row.orders === 0 && row.spend >= 2 * targetCpa) {
    return {
      verdict: "pause",
      headline: "Spending with no sales",
      reasons: [`${Math.round(row.spend)} spent with no attributed orders (2× your target CPA is ${Math.round(2 * targetCpa)})`],
    };
  }

  if (roas !== null && roas < breakeven * 0.5) {
    return {
      verdict: "pause",
      headline: "Far below break-even",
      reasons: [`ROAS ${x(roas)} is under half your break-even ROAS of ${x(breakeven)}`],
    };
  }

  if (ctrDecay !== null && ctrDecay <= -0.25) {
    return {
      verdict: "refresh",
      headline: "Creative is wearing out",
      reasons: [
        `Click-through rate is down ${pctText(ctrDecay)} since its first weeks`,
        roas !== null && roas >= breakeven ? `Still profitable at ${x(roas)}: launch a new variation before it drops further` : `ROAS is ${x(roas)}, below break-even`,
      ],
    };
  }

  if (roas !== null && roas >= target * 1.2) {
    // Only recommend more budget when the creative isn't already tiring.
    if (ctrDecay !== null && ctrDecay <= -0.15) {
      return {
        verdict: "keep",
        headline: "Beating target, but starting to tire",
        reasons: [
          `ROAS ${x(roas)} vs target ${x(target)}`,
          `Click-through rate is down ${pctText(ctrDecay)} since launch: hold the budget and prepare a fresh variation`,
        ],
      };
    }
    return {
      verdict: "scale",
      headline: "Beating your target",
      reasons: [
        `ROAS ${x(roas)} vs target ${x(target)}`,
        ctrDecay === null ? "No sign of fatigue yet" : Math.abs(ctrDecay) < 0.005 ? "Click-through rate is steady" : `Click-through rate is steady (${ctrDecay > 0 ? "up" : "down"} ${pctText(ctrDecay)})`,
        "Try raising the budget 15–20% and re-check in 3–4 days",
      ],
    };
  }

  if (roas !== null && roas < breakeven) {
    return {
      verdict: "watch",
      headline: "Below break-even",
      reasons: [`ROAS ${x(roas)} is under break-even ${x(breakeven)}`, "Test a new hook or audience; pause if it doesn't improve within a week"],
    };
  }

  if (roas !== null && roas < target) {
    return {
      verdict: "watch",
      headline: "Profitable, but under target",
      reasons: [`ROAS ${x(roas)} is between break-even ${x(breakeven)} and target ${x(target)}`],
    };
  }

  return { verdict: "keep", headline: "On target", reasons: [`ROAS ${x(roas)} meets your target of ${x(target)}`] };
}
