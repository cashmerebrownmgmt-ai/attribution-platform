"use client";
import { useState } from "react";
import { niceTicks } from "@/lib/dashboard/format";
import s from "../../dashboard.module.css";
import { fmt, type ValueKind } from "./fmt";
import { useWidth } from "./useWidth";

export type ColumnSeries = { name: string; color: string; values: number[] };

type Props = {
  labels: string[];
  /** Stacked bottom-up in this order. */
  series: ColumnSeries[];
  kind: ValueKind;
  currency?: string;
  height?: number;
  /** Show every nth x label. */
  labelEvery?: number;
  label: string;
};

const PAD = { top: 10, right: 8, bottom: 24, left: 44 };

/** Column chart (optionally stacked) with per-column hover tooltip and a 2px surface gap between segments. */
export function Columns({ labels, series, kind, currency = "USD", height = 200, labelEvery = 1, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const totals = labels.map((_, i) => series.reduce((t, se) => t + (se.values[i] ?? 0), 0));
  const ticks = niceTicks(Math.max(1, ...totals));
  const top = ticks[ticks.length - 1];
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const band = innerW / Math.max(1, labels.length);
  const barW = Math.min(24, Math.max(3, band * 0.62));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;

  return (
    <div className={s.chart} ref={ref}>
      {series.length > 1 && (
        <div className={s.legend}>
          {series.map((se) => (
            <span key={se.name} className={s.legendItem}>
              <span className={s.legendRect} style={{ background: se.color }} />
              {se.name}
            </span>
          ))}
        </div>
      )}
      <svg height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? s.baseline : s.gridline} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text className={s.tick} x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {fmt(kind, t, currency, true)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => {
          const cx = PAD.left + band * i + band / 2;
          let acc = 0;
          return (
            <g
              key={`${l}-${i}`}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${l}: ${series.map((se) => `${se.name} ${fmt(kind, se.values[i], currency)}`).join(", ")}`}
            >
              <rect x={PAD.left + band * i} y={PAD.top} width={band} height={innerH} fill="transparent" />
              {series.map((se, si) => {
                const v = se.values[i] ?? 0;
                if (v <= 0) return null;
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const isTop = series.slice(si + 1).every((o) => (o.values[i] ?? 0) <= 0);
                const h = Math.max(0, y0 - y1 - (si > 0 ? 2 : 0));
                const r = isTop ? Math.min(4, h / 2, barW / 2) : 0;
                const x0 = cx - barW / 2;
                const top = y1;
                const bottom = top + h;
                const d = `M${x0},${bottom}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${bottom}Z`;
                return (
                  <path
                    key={se.name}
                    d={d}
                    fill={se.color}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                    className={s.growY}
                    style={{ animationDelay: `${Math.min(i * 0.01, 0.4)}s` }}
                  />
                );
              })}
              {i % labelEvery === 0 && (
                <text className={s.tick} x={cx} y={height - 6} textAnchor="middle">
                  {l}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className={s.tooltip}
          style={{ left: Math.min(Math.max(PAD.left + band * hover + band / 2, 80), width - 80), top: Math.max(y(totals[hover]), 40) }}
          role="status"
        >
          <div className={s.tooltipTitle}>{labels[hover]}</div>
          {series
            .slice()
            .reverse()
            .map((se) => (
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
