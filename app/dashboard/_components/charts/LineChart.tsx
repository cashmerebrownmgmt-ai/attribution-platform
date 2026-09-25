"use client";
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { niceTicks, shortDate, longDate } from "@/lib/dashboard/format";
import s from "../../dashboard.module.css";
import { fmt, type ValueKind } from "./fmt";
import { useWidth } from "./useWidth";

export type Series = { name: string; color: string; values: (number | null)[]; area?: boolean; dashed?: boolean };

type Props = {
  dates: string[];
  series: Series[];
  kind: ValueKind;
  currency?: string;
  height?: number;
  /** Optional horizontal reference line, e.g. a target ROAS. */
  reference?: { value: number; label: string };
  /** "date" treats x values as YYYY-MM-DD; "raw" shows them as given. */
  xFormat?: "date" | "raw";
  label: string;
  /** Shade these x values (e.g. the selected days when the chart shows extra context). */
  highlight?: { from: string; to: string };
};

const PAD = { top: 12, right: 12, bottom: 26, left: 52 };

/** Line/area time series with crosshair + tooltip, one shared y-axis. */
export function LineChart({ dates, series, kind, currency = "USD", height = 200, reference, xFormat = "date", label, highlight }: Props) {
  const xShort = (d: string) => (xFormat === "date" ? shortDate(d) : d);
  const xLong = (d: string) => (xFormat === "date" ? longDate(d) : d);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const { ticks, y, x, paths } = useMemo(() => {
    const all = series.flatMap((se) => se.values.filter((v): v is number => v !== null));
    const max = Math.max(0, ...all, reference?.value ?? 0);
    const ticks = niceTicks(max || 1);
    const top = ticks[ticks.length - 1] || 1;
    const innerW = width - PAD.left - PAD.right;
    const innerH = height - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (dates.length <= 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
    const paths = series.map((se) => {
      let d = "";
      let area = "";
      let started = false;
      se.values.forEach((v, i) => {
        if (v === null) {
          started = false;
          return;
        }
        d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        started = true;
      });
      if (se.area) {
        const pts = se.values.map((v, i) => `${x(i).toFixed(1)},${y(v ?? 0).toFixed(1)}`);
        area = `M${x(0)},${y(0)}L${pts.join("L")}L${x(dates.length - 1)},${y(0)}Z`;
      }
      return { d, area };
    });
    return { ticks, y, x, paths };
  }, [series, dates, width, height, reference]);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const innerW = width - PAD.left - PAD.right;
    const i = Math.round(((px - PAD.left) / innerW) * (dates.length - 1));
    setHover(Math.max(0, Math.min(dates.length - 1, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(dates.length - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? dates.length) - 1));
    else if (e.key === "Escape") setHover(null);
  };

  // A value with no neighbour draws no line segment, so mark lone points with a dot.
  const lone = series.map((se) => se.values.map((v, i) => v !== null && (se.values[i - 1] ?? null) === null && (se.values[i + 1] ?? null) === null));
  const hi = highlight ? dates.map((d, i) => (d >= highlight.from && d <= highlight.to ? i : -1)).filter((i) => i >= 0) : [];
  const step = dates.length > 1 ? (width - PAD.left - PAD.right) / (dates.length - 1) : width - PAD.left - PAD.right;

  const labelEvery = Math.max(1, Math.ceil(dates.length / Math.max(2, Math.floor((width - 80) / 90))));

  return (
    <div className={s.chart} ref={ref}>
      {series.length > 1 && (
        <div className={s.legend}>
          {series.map((se) => (
            <span key={se.name} className={s.legendItem}>
              <span className={s.legendLine} style={{ background: se.color }} />
              {se.name}
            </span>
          ))}
        </div>
      )}
      <svg
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        {hi.length > 0 && hi.length < dates.length && (
          <rect x={Math.max(PAD.left, x(hi[0]) - step / 2)} width={Math.min(width - PAD.right, x(hi[hi.length - 1]) + step / 2) - Math.max(PAD.left, x(hi[0]) - step / 2)} y={PAD.top} height={height - PAD.top - PAD.bottom} fill="var(--s1)" opacity={0.08} />
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? s.baseline : s.gridline} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text className={s.tick} x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {fmt(kind, t, currency, true)}
            </text>
          </g>
        ))}
        {dates.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d} className={s.tick} x={x(i)} y={height - 6} textAnchor="middle">
              {xShort(d)}
            </text>
          ) : null,
        )}
        {reference && (
          <g>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--ink-2)" strokeDasharray="4 4" strokeWidth={1} opacity={0.6} />
            <text className={s.tick} x={width - PAD.right} y={y(reference.value) - 6} textAnchor="end">
              {reference.label}
            </text>
          </g>
        )}
        {paths.map((p, i) =>
          p.area ? <path key={`a${i}`} d={p.area} fill={series[i].color} fillOpacity={0.1} className={s.fadeIn} /> : null,
        )}
        {paths.map((p, i) => (
          <path
            key={`${series[i].name}-${dates[0]}-${dates.length}`}
            d={p.d}
            className={`${s.line} ${series[i].dashed ? s.fadeIn : s.drawIn}`}
            stroke={series[i].color}
            strokeDasharray={series[i].dashed ? "5 4" : undefined}
            pathLength={series[i].dashed ? undefined : 1}
            style={{ ["--len" as string]: 1, animationDelay: `${i * 0.12}s` }}
          />
        ))}
        {series.map((se, si) =>
          se.values.map((v, i) => (lone[si][i] && v !== null ? <circle key={`${se.name}-dot-${i}`} cx={x(i)} cy={y(v)} r={4} fill={se.color} /> : null)),
        )}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--axis)" strokeWidth={1} />
            {series.map((se) =>
              se.values[hover] !== null ? (
                <circle key={se.name} cx={x(hover)} cy={y(se.values[hover] as number)} r={4.5} fill={se.color} stroke="var(--surface)" strokeWidth={2} />
              ) : null,
            )}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className={s.tooltip} style={{ left: Math.min(Math.max(x(hover), 80), width - 80), top: PAD.top + 8 }} role="status">
          <div className={s.tooltipTitle}>{xLong(dates[hover])}</div>
          {series.map((se) => (
            <div key={se.name} className={s.tooltipRow}>
              <span className={s.legendLine} style={{ background: se.color }} />
              <span className={s.tooltipValue}>{fmt(kind, se.values[hover], currency)}</span>
              <span className={s.tooltipName}>{se.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
