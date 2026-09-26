import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SESSION_IDLE_MS,
  cartNeedsTag,
  cookieDomainCandidates,
  isUuid,
  nextSession,
  parseSession,
  readCookie,
  sourceKey,
  uuid,
  visitorCookie,
} from "@/tracker/core";

const newId = () => "33333333-3333-4333-8333-333333333333";

describe("uuid", () => {
  it("produces v4 UUIDs with and without randomUUID", () => {
    expect(isUuid(uuid(webcrypto as Crypto))).toBe(true);
    const noRandomUUID = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } as Crypto;
    expect(isUuid(uuid(noRandomUUID))).toBe(true);
  });
});

describe("readCookie", () => {
  it("finds a cookie among others and decodes it", () => {
    expect(readCookie("a=1; _ap_vid=abc; cart=c1-x%3Fkey%3D1", "_ap_vid")).toBe("abc");
    expect(readCookie("a=1; cart=c1-x%3Fkey%3D1", "cart")).toBe("c1-x?key=1");
  });
  it("doesn't match a cookie whose name only ends with the target", () => {
    expect(readCookie("x_ap_vid=nope", "_ap_vid")).toBeNull();
  });
  it("returns null for a malformed value", () => {
    expect(readCookie("_ap_vid=%E0%A4%A", "_ap_vid")).toBeNull();
  });
});

describe("cookieDomainCandidates", () => {
  it("goes from the root domain to the full host", () => {
    expect(cookieDomainCandidates("www.shop.example.com")).toEqual([
      "example.com",
      "shop.example.com",
      "www.shop.example.com",
    ]);
  });
  it("tries the public suffix first so the browser can reject it", () => {
    expect(cookieDomainCandidates("shop.example.co.uk")[0]).toBe("co.uk");
  });
  it("uses the bare host for localhost and IPs", () => {
    expect(cookieDomainCandidates("localhost")).toEqual(["localhost"]);
    expect(cookieDomainCandidates("127.0.0.1")).toEqual(["127.0.0.1"]);
  });
});

describe("visitorCookie", () => {
  it("sets domain, 395-day expiry, SameSite=Lax and Secure", () => {
    expect(visitorCookie("id", "example.com", true)).toBe(
      "_ap_vid=id; path=/; max-age=34128000; SameSite=Lax; domain=example.com; Secure",
    );
  });
  it("omits domain for localhost and Secure for http", () => {
    expect(visitorCookie("id", "localhost", false)).toBe("_ap_vid=id; path=/; max-age=34128000; SameSite=Lax");
  });
});

describe("sourceKey", () => {
  it("lists marketing params in a fixed order and ignores others", () => {
    expect(sourceKey("https://s.com/?gclid=g&x=1&utm_source=a")).toBe("utm_source=a&gclid=g");
  });
  it("is empty with no marketing params or a bad URL", () => {
    expect(sourceKey("https://s.com/?page=2")).toBe("");
    expect(sourceKey("nope")).toBe("");
  });
});

describe("nextSession", () => {
  const prev = { id: "11111111-1111-4111-8111-111111111111", t: 1_000_000, k: "utm_source=a" };

  it("starts a session when there is none", () => {
    expect(nextSession(null, 5, "", newId)).toEqual({ id: newId(), t: 5, k: "" });
  });
  it("continues within 30 minutes and keeps the original source", () => {
    expect(nextSession(prev, prev.t + SESSION_IDLE_MS, "", newId)).toEqual({ ...prev, t: prev.t + SESSION_IDLE_MS });
  });
  it("rolls over after 30 idle minutes", () => {
    expect(nextSession(prev, prev.t + SESSION_IDLE_MS + 1, "", newId).id).toBe(newId());
  });
  it("rolls over when a new marketing source arrives, but not for the same one", () => {
    expect(nextSession(prev, prev.t + 1, "utm_source=b", newId).id).toBe(newId());
    expect(nextSession(prev, prev.t + 1, "utm_source=a", newId).id).toBe(prev.id);
  });
});

describe("parseSession", () => {
  it("accepts a valid session and rejects junk", () => {
    const s = { id: "11111111-1111-4111-8111-111111111111", t: 1, k: "" };
    expect(parseSession(JSON.stringify(s))).toEqual(s);
    expect(parseSession("{")).toBeNull();
    expect(parseSession(JSON.stringify({ id: "x", t: 1, k: "" }))).toBeNull();
    expect(parseSession(null)).toBeNull();
  });
});

describe("cartNeedsTag", () => {
  const V = "44444444-4444-4444-8444-444444444444";
  it("tags only a non-empty cart that isn't already tagged with this visitor", () => {
    expect(cartNeedsTag(null, V)).toBe(false);
    expect(cartNeedsTag({ item_count: 0, attributes: {} }, V)).toBe(false);
    expect(cartNeedsTag({ item_count: 2, attributes: {} }, V)).toBe(true);
    expect(cartNeedsTag({ item_count: 2, attributes: { __comet_token: "x" } }, V)).toBe(true);
    expect(cartNeedsTag({ item_count: 2, attributes: { _ap_vid: V } }, V)).toBe(false);
    expect(cartNeedsTag({ item_count: 1, attributes: { _ap_vid: "someone-else" } }, V)).toBe(true);
  });
});

import { cartCountIncreased, isAddToCartAction } from "@/tracker/core";

describe("add-to-cart detection", () => {
  it("fires only when the item count rises within a session", () => {
    expect(cartCountIncreased(null, 2)).toBe(false); // first look
    expect(cartCountIncreased("0", 1)).toBe(true);
    expect(cartCountIncreased("2", 2)).toBe(false);
    expect(cartCountIncreased("3", 1)).toBe(false);
  });
  it("recognizes Shopify product form actions", () => {
    expect(isAddToCartAction("/cart/add")).toBe(true);
    expect(isAddToCartAction("/en-ca/cart/add?view=x")).toBe(true);
    expect(isAddToCartAction("/cart/add.js")).toBe(true);
    expect(isAddToCartAction("/cart")).toBe(false);
    expect(isAddToCartAction(null)).toBe(false);
  });
});

describe("cross-domain helpers", async () => {
  const { decorateStoreUrl, isCartPermalink, isStoreUrl, marketingParams, parseStoreHosts, visitorFromUrl } = await import("@/tracker/core");
  const V = "8b1c4d2e-1f3a-4b5c-9d6e-7f8a9b0c1d2e";
  it("parses store hosts and recognizes store links", () => {
    expect(parseStoreHosts(" https://www.CashmereBrown.com/ , shop.example.com")).toEqual(["cashmerebrown.com", "shop.example.com"]);
    expect(isStoreUrl("https://cashmerebrown.com/cart/1:1", ["cashmerebrown.com"])).toBe(true);
    expect(isStoreUrl("https://www.cashmerebrown.com/", ["cashmerebrown.com"])).toBe(true);
    expect(isStoreUrl("https://evilcashmerebrown.com/", ["cashmerebrown.com"])).toBe(false);
    expect(isStoreUrl("https://lowendbundle.cashmerebrown.com/", ["cashmerebrown.com"])).toBe(false); // a landing page, not the store
    expect(isStoreUrl("mailto:x@cashmerebrown.com", ["cashmerebrown.com"])).toBe(false);
    expect(isStoreUrl("/cart/1:1", ["cashmerebrown.com"], "https://lp.lovable.app/")).toBe(false);
  });
  it("recognizes cart permalinks", () => {
    expect(isCartPermalink("https://cashmerebrown.com/cart/46838815981789:1")).toBe(true);
    expect(isCartPermalink("https://cashmerebrown.com/cart/1:2,3:1")).toBe(true);
    expect(isCartPermalink("https://cashmerebrown.com/cart")).toBe(false);
  });
  it("decorates without overriding params already on the link", () => {
    const out = new URL(decorateStoreUrl("https://cashmerebrown.com/cart/1:1?utm_source=lp&discount=SAVE", V, { utm_source: "facebook", utm_content: "a1" }));
    expect(out.searchParams.get("attributes[_ap_vid]")).toBe(V);
    expect(out.searchParams.get("utm_source")).toBe("lp");
    expect(out.searchParams.get("utm_content")).toBe("a1");
    expect(out.searchParams.get("discount")).toBe("SAVE");
    expect(decorateStoreUrl("https://cashmerebrown.com/cart/1:1", "not-a-uuid", {})).toBe("https://cashmerebrown.com/cart/1:1");
  });
  it("reads marketing params and handed-over visitor IDs", () => {
    expect(marketingParams("https://lp.example/?utm_source=facebook&fbclid=F&x=1")).toEqual({ utm_source: "facebook", fbclid: "F" });
    expect(visitorFromUrl(`https://cashmerebrown.com/?_ap_vid=${V}`)).toBe(V);
    expect(visitorFromUrl("https://cashmerebrown.com/?_ap_vid=junk")).toBeNull();
  });
});

describe("isEditorPreview", async () => {
  const { isEditorPreview } = await import("@/tracker/core");
  it("skips Lovable editor previews but not published pages", () => {
    expect(isEditorPreview("id-preview--8d3ce4d7-4b99-4a20-943c-74032c711533.lovable.app")).toBe(true);
    expect(isEditorPreview("preview--art-of-noise-bundle.lovable.app")).toBe(true);
    expect(isEditorPreview("art-of-noise-bundle.lovable.app")).toBe(false);
    expect(isEditorPreview("lowendbundle.cashmerebrown.com")).toBe(false);
  });
});
