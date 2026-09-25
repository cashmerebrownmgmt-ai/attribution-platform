/** Product-level reporting: what sells, to whom, from which sources, and what sells together. Pure. */
import type { Model } from "../attribution";
import type { Channel } from "../channel";
import { ordersIn, ratio, type DateRange } from "./compute";
import type { DashboardData, Platform } from "./types";

export type ProductRow = {
  key: string;
  title: string;
  orders: number;
  units: number;
  revenue: number;
  share: number;
  avgPrice: number | null;
  newCustomerShare: number | null;
  paidShare: number | null;
  topChannel: Channel | null;
  topPlatform: Platform | null;
};

export function productPerformance(data: DashboardData, r: DateRange, model: Model): ProductRow[] {
  const orders = ordersIn(data, r);
  const total = orders.reduce((t, o) => t + o.items.reduce((s, i) => s + i.revenue, 0), 0);
  const rows = new Map<string, { title: string; orders: number; units: number; revenue: number; newOrders: number; paid: number; channels: Map<Channel, number>; platforms: Map<Platform, number> }>();
  for (const o of orders) {
    const t = o.touches[model];
    for (const i of o.items) {
      const row = rows.get(i.key) ?? { title: i.title, orders: 0, units: 0, revenue: 0, newOrders: 0, paid: 0, channels: new Map(), platforms: new Map() };
      row.orders += 1;
      row.units += i.quantity;
      row.revenue += i.revenue;
      if (o.isNew) row.newOrders += 1;
      if (t.platform) {
        row.paid += 1;
        row.platforms.set(t.platform, (row.platforms.get(t.platform) ?? 0) + i.revenue);
      }
      row.channels.set(t.channel, (row.channels.get(t.channel) ?? 0) + i.revenue);
      rows.set(i.key, row);
    }
  }
  const top = <K,>(m: Map<K, number>): K | null => ([...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null);
  return [...rows.entries()]
    .map(([key, x]) => ({
      key,
      title: x.title,
      orders: x.orders,
      units: x.units,
      revenue: Math.round(x.revenue * 100) / 100,
      share: total > 0 ? x.revenue / total : 0,
      avgPrice: ratio(x.revenue, x.units),
      newCustomerShare: ratio(x.newOrders, x.orders),
      paidShare: ratio(x.paid, x.orders),
      topChannel: top(x.channels),
      topPlatform: top(x.platforms),
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export type Pair = { a: string; b: string; orders: number; lift: number | null };

/** Products bought together in the same order, with lift (how much more often than by chance). */
export function boughtTogether(data: DashboardData, r: DateRange, limit = 10): Pair[] {
  const orders = ordersIn(data, r).filter((o) => o.items.length > 0);
  const n = orders.length;
  const single = new Map<string, number>();
  const pairs = new Map<string, number>();
  const titles = new Map<string, string>();
  for (const o of orders) {
    const keys = [...new Set(o.items.map((i) => i.key))].sort();
    for (const i of o.items) titles.set(i.key, i.title);
    for (const k of keys) single.set(k, (single.get(k) ?? 0) + 1);
    for (let x = 0; x < keys.length; x++) for (let y = x + 1; y < keys.length; y++) pairs.set(`${keys[x]}|${keys[y]}`, (pairs.get(`${keys[x]}|${keys[y]}`) ?? 0) + 1);
  }
  return [...pairs.entries()]
    .filter(([, c]) => c >= 2)
    .map(([k, c]) => {
      const [a, b] = k.split("|");
      const expected = ((single.get(a) ?? 0) * (single.get(b) ?? 0)) / Math.max(1, n);
      return { a: titles.get(a) ?? a, b: titles.get(b) ?? b, orders: c, lift: expected > 0 ? c / expected : null };
    })
    .sort((x, y) => y.orders - x.orders)
    .slice(0, limit);
}
