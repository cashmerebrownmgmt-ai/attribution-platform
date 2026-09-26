// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init, track } from "@/tracker/index";
import { trackLanding } from "@/tracker/landing";

const ENDPOINT = "https://app.example.com/api/collect";
const SCRIPT = "https://app.example.com/t.js";
type Beacon = { url: string; body: Record<string, unknown> };

let beacons: Beacon[];
let fetchMock: ReturnType<typeof vi.fn>;
let cartAttributes: Record<string, string>;
let cartItems: number;

function clearCookies() {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; max-age=0; path=/`;
  }
}

beforeEach(() => {
  clearCookies();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/products/tee?utm_source=google&utm_medium=cpc&gclid=g1");
  beacons = [];
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: (url: string, body: string) => {
      beacons.push({ url, body: JSON.parse(body) });
      return true;
    },
  });
  cartAttributes = {};
  cartItems = 1;
  fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url.endsWith("cart.js")) return new Response(JSON.stringify({ token: "c1", item_count: cartItems, attributes: cartAttributes }));
    if (url.endsWith("cart/update.js")) {
      Object.assign(cartAttributes, JSON.parse(String(opts?.body)).attributes);
      return new Response("{}");
    }
    return new Response(null, { status: 404 });
  });
  window.fetch = fetchMock as unknown as typeof fetch;
  delete (window as { __apTracker?: boolean }).__apTracker;
  delete (window as { Shopify?: unknown }).Shopify;
});

afterEach(() => vi.restoreAllMocks());

const flush = () => new Promise((r) => setTimeout(r, 0));
const cookie = (name: string) =>
  document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1];

describe("track", () => {
  it("sends a page view with a persistent visitor ID and session", () => {
    track(window, ENDPOINT);
    expect(beacons).toHaveLength(1);
    const { url, body } = beacons[0];
    expect(url).toBe(ENDPOINT);
    expect(body).toMatchObject({
      type: "page_view",
      source: "tracker",
      url: window.location.href,
      visitor_id: cookie("_ap_vid"),
    });
    expect(JSON.parse(sessionStorage.getItem("_ap_s")!).id).toBe(body.session_id);

    track(window, ENDPOINT);
    expect(beacons[1].body.visitor_id).toBe(body.visitor_id);
    expect(beacons[1].body.session_id).toBe(body.session_id);
    expect(beacons[1].body.id).not.toBe(body.id);
  });

  it("keeps an existing visitor cookie", () => {
    document.cookie = "_ap_vid=44444444-4444-4444-8444-444444444444; path=/";
    track(window, ENDPOINT);
    expect(beacons[0].body.visitor_id).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("replaces a tampered visitor cookie", () => {
    document.cookie = "_ap_vid=not-a-uuid; path=/";
    track(window, ENDPOINT);
    expect(beacons[0].body.visitor_id).not.toBe("not-a-uuid");
  });

  it("starts a new session when a different campaign arrives", () => {
    track(window, ENDPOINT);
    window.history.replaceState(null, "", "/?utm_source=meta");
    track(window, ENDPOINT);
    expect(beacons[1].body.session_id).not.toBe(beacons[0].body.session_id);
  });

  it("falls back to fetch when sendBeacon is unavailable", () => {
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: undefined });
    track(window, ENDPOINT);
    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ method: "POST", keepalive: true }));
  });

  it("tags a non-empty cart with the visitor ID, without needing a cart cookie", async () => {
    cartAttributes.__comet_token = "other-app";
    track(window, ENDPOINT);
    await flush();
    expect(cartAttributes._ap_vid).toBe(beacons[0].body.visitor_id);
    expect(cartAttributes.__comet_token).toBe("other-app"); // other apps' attributes kept
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("cart/update.js"))).toHaveLength(1);

    // Already tagged: later page views only read the cart.
    track(window, ENDPOINT);
    await flush();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("cart/update.js"))).toHaveLength(1);
  });

  it("leaves an empty cart alone", async () => {
    cartItems = 0;
    track(window, ENDPOINT);
    await flush();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("cart/update.js"))).toBe(false);
  });

  it("uses the store's locale root for cart requests", async () => {
    (window as { Shopify?: unknown }).Shopify = { routes: { root: "/en-ca/" } };
    track(window, ENDPOINT);
    await flush();
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toContain("/en-ca/cart.js");
  });

  it("swallows cart errors", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(() => track(window, ENDPOINT)).not.toThrow();
    await flush();
  });
});

describe("init and consent", () => {
  it("sends to /api/collect on the script's origin, once per page", () => {
    init(window, SCRIPT);
    init(window, SCRIPT);
    expect(beacons.map((b) => b.url)).toEqual([ENDPOINT]);
  });

  it("does nothing without a script URL", () => {
    init(window, null);
    expect(beacons).toHaveLength(0);
  });

  it("waits for consent, then tracks once it's given", () => {
    let allowed = false;
    (window as { Shopify?: unknown }).Shopify = { customerPrivacy: { analyticsProcessingAllowed: () => allowed } };
    init(window, SCRIPT);
    expect(beacons).toHaveLength(0);
    expect(cookie("_ap_vid")).toBeUndefined();

    allowed = true;
    document.dispatchEvent(new Event("visitorConsentCollected"));
    document.dispatchEvent(new Event("visitorConsentCollected"));
    expect(beacons).toHaveLength(1);
  });

  it("loads Shopify's consent API when the theme hasn't", () => {
    const loadFeatures = vi.fn((_f: unknown, cb: () => void) => {
      (window as unknown as { Shopify: { customerPrivacy?: unknown } }).Shopify.customerPrivacy = {
        analyticsProcessingAllowed: () => true,
      };
      cb();
    });
    (window as { Shopify?: unknown }).Shopify = { loadFeatures };
    init(window, SCRIPT);
    expect(loadFeatures).toHaveBeenCalledWith([{ name: "consent-tracking-api", version: "0.1" }], expect.any(Function));
    expect(beacons).toHaveLength(1);
  });
});

describe("landing pages on other domains", () => {
  const STORE = ["cashmerebrown.com"];
  const V = () => cookie("_ap_vid")!;

  beforeEach(() => {
    window.history.replaceState(null, "", "/?utm_source=facebook&utm_medium=paid&utm_campaign=c1&utm_content=a1&fbclid=F1");
  });

  it("tracks the landing visit but leaves the Shopify cart alone", async () => {
    trackLanding(window, ENDPOINT, STORE);
    await flush();
    expect(beacons).toHaveLength(1);
    expect(beacons[0].body).toMatchObject({ type: "page_view" });
    expect(String(beacons[0].body.url)).toContain("utm_content=a1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds the visitor ID and ad params to cart-permalink links as they're clicked", () => {
    trackLanding(window, ENDPOINT, STORE);
    const a = document.createElement("a");
    a.href = "https://cashmerebrown.com/cart/46838815981789:1";
    a.target = "_blank";
    a.addEventListener("click", (e) => e.preventDefault()); // don't navigate jsdom
    document.body.appendChild(a);
    a.click();
    const u = new URL(a.href);
    expect(u.searchParams.get("attributes[_ap_vid]")).toBe(V());
    expect(u.searchParams.get("_ap_vid")).toBe(V());
    expect(u.searchParams.get("utm_content")).toBe("a1");
    expect(u.searchParams.get("fbclid")).toBe("F1");
    // (Listeners from earlier tests share this jsdom document; on a real page the script runs once.)
    expect(beacons[0].body.type).toBe("page_view");
    expect(beacons.some((b) => b.body.type === "add_to_cart" && b.body.visitor_id === V())).toBe(true);
    a.remove();
  });

  it("decorates window.open to the store, and nothing else", () => {
    const opened: (string | undefined)[] = [];
    window.open = ((u?: string | URL) => (opened.push(u === undefined ? u : String(u)), null)) as typeof window.open;
    trackLanding(window, ENDPOINT, STORE);
    window.open("https://cashmerebrown.com/cart/47359723962589:1", "_blank", "noopener,noreferrer");
    window.open("https://example.org/page", "_blank");
    expect(new URL(opened[0]!).searchParams.get("attributes[_ap_vid]")).toBe(V());
    expect(opened[1]).toBe("https://example.org/page");
  });

  it("keeps the session's ad params on later pages without UTMs", () => {
    trackLanding(window, ENDPOINT, STORE);
    window.history.replaceState(null, "", "/faq");
    delete (window as { __apTracker?: boolean }).__apTracker;
    const opened: string[] = [];
    window.open = ((u?: string | URL) => (opened.push(String(u)), null)) as typeof window.open;
    trackLanding(window, ENDPOINT, STORE);
    window.open("https://www.cashmerebrown.com/collections/all");
    const u = new URL(opened[0]);
    expect(u.searchParams.get("utm_campaign")).toBe("c1");
    expect(u.searchParams.get("_ap_vid")).toBe(V());
    expect(u.searchParams.has("attributes[_ap_vid]")).toBe(false); // not a cart permalink
  });

  it("on the store, continues the visitor a landing page handed over", () => {
    const handed = "8b1c4d2e-1f3a-4b5c-9d6e-7f8a9b0c1d2e";
    window.history.replaceState(null, "", `/products/tee?_ap_vid=${handed}`);
    track(window, ENDPOINT);
    expect(beacons[0].body.visitor_id).toBe(handed);
  });
});
