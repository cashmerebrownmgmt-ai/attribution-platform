import { describe, expect, it } from "vitest";
import { isExternalReferrer, isTouchpoint, parseSource } from "@/lib/source";

const PAGE = "https://shop.example.com/products/tee";

describe("parseSource", () => {
  it("reads UTMs and click IDs from the page URL", () => {
    const s = parseSource(`${PAGE}?utm_source=google&utm_medium=cpc&utm_campaign=fall&gclid=abc`, null);
    expect(s).toMatchObject({ utm_source: "google", utm_medium: "cpc", utm_campaign: "fall", gclid: "abc" });
    expect(s.utm_term).toBeNull();
    expect(s.fbclid).toBeNull();
  });

  it("treats blank params as missing and truncates very long ones", () => {
    const s = parseSource(`${PAGE}?utm_source=%20&utm_campaign=${"x".repeat(600)}`, null);
    expect(s.utm_source).toBeNull();
    expect(s.utm_campaign).toHaveLength(500);
  });

  it("survives a malformed URL", () => {
    expect(parseSource("not a url", "also not").utm_source).toBeNull();
  });
});

describe("isExternalReferrer", () => {
  it.each([
    ["https://www.google.com/", true],
    ["https://instagram.com/p/1", true],
    ["https://shop.example.com/collections/all", false], // same site
    ["https://www.shop.example.com/", false], // www variant
    ["https://store.myshopify.com/", false], // shopify domain
    ["https://checkout.shopify.com/", false],
    ["https://www.paypal.com/checkoutnow", false], // payment return
    ["android-app://com.google.android.gm/", false], // non-http
    [null, false],
  ])("%s -> %s", (ref, expected) => {
    expect(isExternalReferrer(PAGE, ref)).toBe(expected);
  });

  it("treats the store's other domains as internal", () => {
    expect(isExternalReferrer(PAGE, "https://old-brand.com/", ["old-brand.com"])).toBe(false);
  });
});

describe("isTouchpoint", () => {
  it("is true for a UTM, a click ID or an external referrer, false otherwise", () => {
    expect(isTouchpoint(parseSource(`${PAGE}?utm_source=x`, null))).toBe(true);
    expect(isTouchpoint(parseSource(`${PAGE}?ttclid=1`, null))).toBe(true);
    expect(isTouchpoint(parseSource(PAGE, "https://bing.com/"))).toBe(true);
    expect(isTouchpoint(parseSource(PAGE, `${PAGE}?a=1`))).toBe(false);
    expect(isTouchpoint(parseSource(PAGE, null))).toBe(false);
  });
});
