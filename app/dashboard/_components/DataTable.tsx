"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import s from "../dashboard.module.css";
import { fmt, type ValueKind } from "./charts/fmt";

export type Column = {
  key: string;
  label: string;
  kind?: ValueKind | "text";
  /** Color the value against a target: higher-is-better ("gte") or lower-is-better ("lte"). */
  target?: { value: number; better: "gte" | "lte" };
};

export type Row = {
  id: string;
  name: string;
  href?: string;
  color?: string;
  badge?: string;
  values: Record<string, number | string | null>;
};

type Props = { columns: Column[]; rows: Row[]; currency?: string; defaultSort?: string; nameLabel: string; empty?: string };

/** Sortable table; every chart's "view as table" and the campaign drill-down use it. */
export function DataTable({ columns, rows, currency = "USD", defaultSort, nameLabel, empty = "No data for this range." }: Props) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: defaultSort ?? columns[0]?.key ?? "name", dir: -1 });

  const sorted = useMemo(() => {
    const val = (r: Row) => (sort.key === "name" ? r.name : r.values[sort.key]);
    return rows.slice().sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sort.dir;
      return String(va).localeCompare(String(vb)) * sort.dir;
    });
  }, [rows, sort]);

  const header = (key: string, label: string) => (
    <button
      className={s.sortButton}
      onClick={() => setSort((cur) => ({ key, dir: cur.key === key ? ((cur.dir * -1) as 1 | -1) : -1 }))}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
    </button>
  );

  if (!rows.length) return <div className={s.empty}>{empty}</div>;

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th aria-sort={sort.key === "name" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>{header("name", nameLabel)}</th>
            {columns.map((c) => (
              <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                {header(c.key, c.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td>
                <span className={s.nameCell}>
                  {r.color && <span className={s.swatch} style={{ background: r.color }} />}
                  {r.href ? <Link href={r.href}>{r.name}</Link> : <span>{r.name}</span>}
                  {r.badge && <span className={s.statusChip}>{r.badge}</span>}
                </span>
              </td>
              {columns.map((c) => {
                const v = r.values[c.key];
                const text = c.kind === "text" || typeof v === "string" ? (v ?? "—") : fmt(c.kind ?? "number", v as number | null, currency);
                let cls = "";
                if (c.target && typeof v === "number") {
                  const ok = c.target.better === "gte" ? v >= c.target.value : v <= c.target.value;
                  cls = ok ? s.goodText : s.badText;
                }
                return (
                  <td key={c.key} className={cls}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
