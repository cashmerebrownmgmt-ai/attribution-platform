"use client";
import { useMemo, useState } from "react";
import s from "../../dashboard.module.css";
import { useWidth } from "./useWidth";

type Flow = { from: string; to: string; orders: number };

type Props = {
  flows: Flow[];
  labels: Record<string, string>;
  leftTitle: string;
  rightTitle: string;
  height?: number;
  label: string;
};

const NODE_W = 12;
const GAP = 10;
const LABEL_W = 130;

/** Two-column flow diagram: where journeys started → which touch got last credit. Hover a band or node to focus it. */
export function Sankey({ flows, labels, leftTitle, rightTitle, height = 340, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [focus, setFocus] = useState<string | null>(null);

  const layout = useMemo(() => {
    const total = flows.reduce((t, f) => t + f.orders, 0) || 1;
    const sideTotals = (side: "from" | "to") => {
      const m = new Map<string, number>();
      for (const f of flows) m.set(f[side], (m.get(f[side]) ?? 0) + f.orders);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const left = sideTotals("from");
    const right = sideTotals("to");
    const usable = (n: number) => height - 30 - GAP * Math.max(0, n - 1);
    const place = (nodes: [string, number][]) => {
      const scale = usable(nodes.length) / total;
      let y = 24;
      return new Map(
        nodes.map(([k, v]) => {
          const h = Math.max(2, v * scale);
          const node = { key: k, y, h, value: v, offset: 0 };
          y += h + GAP;
          return [k, node];
        }),
      );
    };
    const L = place(left);
    const R = place(right);
    const x0 = LABEL_W;
    const x1 = width - LABEL_W;
    const scaleL = usable(left.length) / total;
    const scaleR = usable(right.length) / total;
    const links = flows
      .slice()
      .sort((a, b) => (L.get(a.from)!.y - L.get(b.from)!.y) || (R.get(a.to)!.y - R.get(b.to)!.y))
      .map((f) => {
        const a = L.get(f.from)!;
        const b = R.get(f.to)!;
        const ha = f.orders * scaleL;
        const hb = f.orders * scaleR;
        const ya = a.y + a.offset;
        const yb = b.y + b.offset;
        a.offset += ha;
        b.offset += hb;
        const xa = x0 + NODE_W;
        const xb = x1;
        const mx = (xa + xb) / 2;
        const d = `M${xa},${ya}C${mx},${ya} ${mx},${yb} ${xb},${yb}L${xb},${yb + hb}C${mx},${yb + hb} ${mx},${ya + ha} ${xa},${ya + ha}Z`;
        return { ...f, d, share: f.orders / total };
      });
    return { L: [...L.values()], R: [...R.values()], links, x0, x1, total };
  }, [flows, width, height]);

  const name = (k: string) => labels[k.split(":")[1]] ?? k.split(":")[1];
  const active = (f: Flow) => focus === null || focus === f.from || focus === f.to || focus === `${f.from}|${f.to}`;

  return (
    <div className={s.chart} ref={ref}>
      <svg height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} onPointerLeave={() => setFocus(null)}>
        <text className={s.tick} x={layout.x0 + NODE_W} y={12} textAnchor="end">
          {leftTitle}
        </text>
        <text className={s.tick} x={layout.x1} y={12}>
          {rightTitle}
        </text>
        {layout.links.map((l) => (
          <path
            key={`${l.from}|${l.to}`}
            d={l.d}
            fill="var(--s1)"
            fillOpacity={active(l) ? (focus ? 0.5 : 0.28) : 0.06}
            className={s.fadeIn}
            onPointerEnter={() => setFocus(`${l.from}|${l.to}`)}
          >
            <title>{`${name(l.from)} → ${name(l.to)}: ${l.orders.toLocaleString()} orders (${(l.share * 100).toFixed(1)}%)`}</title>
          </path>
        ))}
        {layout.L.map((n) => (
          <g key={n.key} onPointerEnter={() => setFocus(n.key)}>
            <rect x={layout.x0} y={n.y} width={NODE_W} height={n.h} rx={3} fill="var(--s1)" />
            <text x={layout.x0 - 8} y={n.y + n.h / 2} dy="0.32em" textAnchor="end" fontSize={12} fill="var(--ink)">
              {name(n.key)} <tspan fill="var(--muted)">{n.value.toLocaleString()}</tspan>
            </text>
          </g>
        ))}
        {layout.R.map((n) => (
          <g key={n.key} onPointerEnter={() => setFocus(n.key)}>
            <rect x={layout.x1} y={n.y} width={NODE_W} height={n.h} rx={3} fill="var(--s1)" />
            <text x={layout.x1 + NODE_W + 8} y={n.y + n.h / 2} dy="0.32em" fontSize={12} fill="var(--ink)">
              {name(n.key)} <tspan fill="var(--muted)">{n.value.toLocaleString()}</tspan>
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
