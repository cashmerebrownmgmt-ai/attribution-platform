/** Customer value: repeat purchase and lifetime value by the channel that first brought them in. Pure. */
import type { Channel } from "../channel";
import { dayOf, ratio } from "./compute";
import type { DashboardData, OrderFact } from "./types";

const DAY = 86_400_000;

export type Customer = { key: string; first: OrderFact; orders: OrderFact[]; channel: Channel };

/** Customers whose first order is in [from, to] (so their later behavior can be measured). */
export function customersAcquired(data: DashboardData, from: string, to: string): Customer[] {
  const byCustomer = new Map<string, OrderFact[]>();
  for (const o of data.orders) {
    if (o.cancelled || !o.customerKey) continue;
    const list = byCustomer.get(o.customerKey) ?? [];
    list.push(o);
    byCustomer.set(o.customerKey, list);
  }
  const out: Customer[] = [];
  for (const [key, orders] of byCustomer) {
    orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const first = orders[0];
    const day = dayOf(first.createdAt);
    if (day >= from && day <= to) out.push({ key, first, orders, channel: first.touches.first_touch.channel });
  }
  return out;
}

export type LtvRow = {
  channel: Channel | "all";
  customers: number;
  firstOrderValue: number | null;
  ltv30: number | null;
  ltv90: number | null;
  ltvAll: number | null;
  repeatRate90: number | null;
  ordersPerCustomer: number | null;
  daysToSecond: number | null;
};

function ltvFor(cs: Customer[], asOf: number, channel: LtvRow["channel"]): LtvRow {
  // Only customers old enough for each window count toward it, so recent customers don't drag averages down.
  const window = (days: number) => {
    const eligible = cs.filter((c) => Date.parse(c.first.createdAt) + days * DAY <= asOf);
    const value = eligible.reduce((t, c) => t + c.orders.filter((o) => Date.parse(o.createdAt) <= Date.parse(c.first.createdAt) + days * DAY).reduce((s, o) => s + o.revenue, 0), 0);
    return { eligible, value: ratio(value, eligible.length) };
  };
  const w90 = window(90);
  const repeat90 = w90.eligible.filter((c) => c.orders.some((o, i) => i > 0 && Date.parse(o.createdAt) <= Date.parse(c.first.createdAt) + 90 * DAY)).length;
  const seconds = cs.filter((c) => c.orders.length > 1).map((c) => (Date.parse(c.orders[1].createdAt) - Date.parse(c.first.createdAt)) / DAY).sort((a, b) => a - b);
  return {
    channel,
    customers: cs.length,
    firstOrderValue: ratio(cs.reduce((t, c) => t + c.first.revenue, 0), cs.length),
    ltv30: window(30).value,
    ltv90: w90.value,
    ltvAll: ratio(cs.reduce((t, c) => t + c.orders.reduce((s, o) => s + o.revenue, 0), 0), cs.length),
    repeatRate90: ratio(repeat90, w90.eligible.length),
    ordersPerCustomer: ratio(cs.reduce((t, c) => t + c.orders.length, 0), cs.length),
    daysToSecond: seconds.length ? seconds[Math.floor(seconds.length / 2)] : null,
  };
}

export function ltvByChannel(data: DashboardData, from: string, to: string, asOf: number): LtvRow[] {
  const cs = customersAcquired(data, from, to);
  const byChannel = new Map<Channel, Customer[]>();
  for (const c of cs) {
    const g = byChannel.get(c.channel);
    if (g) g.push(c);
    else byChannel.set(c.channel, [c]);
  }
  return [ltvFor(cs, asOf, "all"), ...[...byChannel.entries()].map(([ch, list]) => ltvFor(list, asOf, ch)).sort((a, b) => b.customers - a.customers)];
}

export type CohortRow = { month: string; customers: number; retention: (number | null)[]; revenuePerCustomer: (number | null)[] };

/** Monthly cohorts: share of customers who bought again, and cumulative revenue per customer, by months since first order. */
export function cohorts(data: DashboardData, months: number, asOf: number): CohortRow[] {
  const endDay = dayOf(new Date(asOf).toISOString());
  const [ey, em] = endDay.split("-").map(Number);
  const startMonth = new Date(Date.UTC(ey, em - 1 - (months - 1), 1)).toISOString().slice(0, 10);
  const cs = customersAcquired(data, startMonth, endDay);
  const byMonth = new Map<string, Customer[]>();
  for (const c of cs) {
    const m = dayOf(c.first.createdAt).slice(0, 7);
    const g = byMonth.get(m);
    if (g) g.push(c);
    else byMonth.set(m, [c]);
  }
  // Months counted in the store's time zone, like every other date on the dashboard.
  const monthIndex = (iso: string) => {
    const [y, m] = dayOf(iso).split("-").map(Number);
    return y * 12 + (m - 1);
  };
  const nowIdx = monthIndex(endDay);
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => {
      const m0 = monthIndex(`${month}-01`);
      const span = nowIdx - m0;
      const retention: (number | null)[] = [];
      const revenue: (number | null)[] = [];
      for (let k = 0; k < months; k++) {
        if (k > span) {
          retention.push(null);
          revenue.push(null);
          continue;
        }
        const active = list.filter((c) => c.orders.some((o, i) => i > 0 && monthIndex(o.createdAt) - m0 === k)).length;
        const rev = list.reduce((t, c) => t + c.orders.filter((o) => monthIndex(o.createdAt) - m0 <= k).reduce((s, o) => s + o.revenue, 0), 0);
        retention.push(k === 0 ? ratio(list.filter((c) => c.orders.filter((o) => monthIndex(o.createdAt) === m0).length > 1).length, list.length) : ratio(active, list.length));
        revenue.push(ratio(rev, list.length));
      }
      return { month, customers: list.length, retention, revenuePerCustomer: revenue };
    });
}
