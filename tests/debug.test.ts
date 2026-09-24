import { describe, expect, it } from "vitest";
import { formatMoney, formatPercent, matchStats, parseSearch } from "@/lib/debug";

describe("parseSearch", () => {
  it.each([
    ["#1001", { kind: "order_name", value: "#1001" }],
    ["1001", { kind: "order_name", value: "#1001" }],
    ["5801234567890", { kind: "order_id", value: "5801234567890" }],
    ["gid://shopify/Order/5801234567890", { kind: "order_id", value: "5801234567890" }],
    ["11111111-1111-4111-8111-11111111111A", { kind: "visitor", value: "11111111-1111-4111-8111-11111111111a" }],
    ["b1946ac92492d2347c6235b4d2611184", { kind: "checkout", value: "b1946ac92492d2347c6235b4d2611184" }],
    ["  ", { kind: "none" }],
    ["drop table; --", { kind: "none" }],
  ])("%s", (q, expected) => {
    expect(parseSearch(q)).toEqual(expected);
  });
});

describe("matchStats", () => {
  const since = new Date("2026-09-17T00:00:00Z");
  it("counts matched orders in range by method", () => {
    const s = matchStats(
      [
        { created_at: "2026-09-20T00:00:00Z", stitch_method: "cart_attribute" },
        { created_at: "2026-09-21T00:00:00Z", stitch_method: "checkout_token" },
        { created_at: "2026-09-22T00:00:00Z", stitch_method: "none" },
        { created_at: "2026-09-10T00:00:00Z", stitch_method: "none" }, // out of range
      ],
      since,
    );
    expect(s).toEqual({ total: 3, matched: 2, rate: 2 / 3, byMethod: { cart_attribute: 1, checkout_token: 1, none: 1 } });
  });
  it("has no rate without orders", () => {
    expect(matchStats([], since).rate).toBeNull();
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatting", () => {
  it("formats percentages and money", () => {
    expect(formatPercent(2 / 3)).toBe("66.7%");
    expect(formatMoney("84.5", "USD")).toBe("$84.50");
    expect(formatMoney(null, "USD")).toBe("—");
    expect(formatMoney("10", "XXX-bad")).toBe("10.00 XXX-bad");
  });
});
