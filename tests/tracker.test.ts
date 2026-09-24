// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init, track } from "@/tracker/index";

const ENDPOINT = "https://app.example.com/api/collect";
const SCRIPT = "https://app.example.com/t.js";
type Beacon = { url: string; body: Record<string, unknown> };

let beacons: Beacon[];
let fetchMock: ReturnType<typeof vi.fn>;
let cartAttributes: Record<string, string>;

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
  fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url.endsWith("cart.js")) return new Response(JSON.stringify({ token: "c1", attributes: cartAttributes }));
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

  it("writes the visitor ID to the cart once per cart", async () => {
    document.cookie = "cart=c1; path=/";
    track(window, ENDPOINT);
    await flush();
    expect(cartAttributes._ap_vid).toBe(beacons[0].body.visitor_id);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("cart/update.js"))).toHaveLength(1);

    track(window, ENDPOINT);
    await flush();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("cart.js"))).toHaveLength(1);
  });

  it("skips the update when the cart already has the attribute", async () => {
    document.cookie = "_ap_vid=44444444-4444-4444-8444-444444444444; path=/";
    document.cookie = "cart=c1; path=/";
    cartAttributes._ap_vid = "44444444-4444-4444-8444-444444444444";
    track(window, ENDPOINT);
    await flush();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("cart/update.js"))).toBe(false);
  });

  it("does nothing with the cart when there is no cart cookie", async () => {
    track(window, ENDPOINT);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows cart errors", async () => {
    document.cookie = "cart=c1; path=/";
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
