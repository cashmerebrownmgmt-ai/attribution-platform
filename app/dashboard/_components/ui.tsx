import type { ReactNode } from "react";
import { MODELS } from "@/lib/attribution";
import { MODEL_LABELS, PLATFORM_LABELS, PRESETS, type ParsedFilters } from "@/lib/dashboard/filters";
import { shortDate, signedPct } from "@/lib/dashboard/format";
import { todayUtc } from "@/lib/dashboard/data";
import { delta } from "@/lib/metrics/compute";
import { AD_PLATFORMS, type Platform } from "@/lib/metrics/types";
import s from "../dashboard.module.css";
import { FilterBar } from "./FilterBar";
import { Sparkline } from "./charts/Sparkline";

export const PLATFORM_COLORS: Record<Platform, string> = {
  meta: "var(--s1)",
  google: "var(--s2)",
  tiktok: "var(--s3)",
  microsoft: "var(--s4)",
};

export function PageHead({ title, subtitle, mode, action }: { title: string; subtitle?: string; mode: "live" | "demo"; action?: ReactNode }) {
  return (
    <div className={s.pageHead}>
      <div>
        <h1 className={s.title}>{title}</h1>
        {subtitle && <p className={s.subtitle}>{subtitle}</p>}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {action}
        <ModeSwitch mode={mode} />
      </div>
    </div>
  );
}

export function ModeSwitch({ mode }: { mode: "live" | "demo" }) {
  const next = mode === "demo" ? "live" : "demo";
  return (
    <form action="/dashboard/mode" method="post">
      <input type="hidden" name="mode" value={next} />
      <button className={s.modeBadge} type="submit" title={`Switch to ${next} data`}>
        <span className={`${s.modeDot} ${mode === "live" ? s.modeDotLive : ""}`} aria-hidden="true" />
        {mode === "demo" ? "Demo data" : "Live data"}
        <span className={s.muted}>· switch</span>
      </button>
    </form>
  );
}

export function Filters({ f, showPlatform = true }: { f: ParsedFilters; showPlatform?: boolean }) {
  return (
    <FilterBar
      preset={f.preset}
      model={f.model}
      platform={f.platform}
      from={f.range.from}
      to={f.range.to}
      today={todayUtc()}
      rangeText={f.range.from === f.range.to ? shortDate(f.range.from) : `${shortDate(f.range.from)} – ${shortDate(f.range.to)}`}
      presets={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
      models={MODELS.map((m) => ({ value: m, label: MODEL_LABELS[m] }))}
      platforms={[{ value: "all", label: "All platforms" }, ...AD_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))]}
      showPlatform={showPlatform}
    />
  );
}

export function Card({ title, sub, children, action }: { title?: string; sub?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className={s.card}>
      {(title || action) && (
        <div className={s.cardHead}>
          <div>
            {title && <h2 className={s.cardTitle}>{title}</h2>}
            {sub && <p className={s.cardSub}>{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function TableToggle({ children, label = "View as table" }: { children: ReactNode; label?: string }) {
  return (
    <details className={s.tableToggle}>
      <summary>{label}</summary>
      {children}
    </details>
  );
}

/**
 * Stat tile: label, value, change vs previous period (colored by whether up is good), optional
 * sparkline and target.
 */
export function Kpi({
  label,
  value,
  current,
  previous,
  upIsGood = true,
  neutral = false,
  trend,
  target,
}: {
  label: string;
  value: string;
  current: number | null;
  previous: number | null;
  upIsGood?: boolean;
  /** Direction is neither good nor bad (e.g. spend). */
  neutral?: boolean;
  trend?: (number | null)[];
  target?: string;
}) {
  const d = delta(current, previous);
  const good = neutral || d === null || Math.abs(d) < 0.005 ? null : d > 0 === upIsGood;
  return (
    <div className={s.card}>
      <div className={s.kpiLabel}>{label}</div>
      <div className={`${s.kpiValue} ${s.countUp}`}>{value}</div>
      <div className={s.kpiFoot}>
        <span className={`${s.delta} ${good === null ? s.deltaFlat : good ? s.deltaGood : s.deltaBad}`} title="Change vs previous period">
          {d === null ? "—" : `${d > 0 ? "▲" : d < 0 ? "▼" : ""} ${signedPct(d)}`}
          <span className={s.muted} style={{ fontWeight: 400 }}>
            {" "}
            vs prev.
          </span>
        </span>
        {trend && <Sparkline values={trend} />}
      </div>
      {target && <div className={s.kpiTarget}>{target}</div>}
    </div>
  );
}

export function StatusIcon({ level }: { level: "ok" | "warn" | "bad" }) {
  const cls = level === "ok" ? s.statusOk : level === "warn" ? s.statusWarn : s.statusBad;
  return (
    <span className={`${s.statusIcon} ${cls}`} aria-label={level === "ok" ? "Healthy" : level === "warn" ? "Warning" : "Problem"}>
      {level === "ok" ? "✓" : "!"}
    </span>
  );
}
