import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BODY_BYTES,
  handleCollect,
  handleCollectPreflight,
  hashIp,
  parseAllowedOrigins,
  type CollectDeps,
  type EventRow,
} from "@/lib/collect";

const ORIGIN = "https://shop.example.com";
const NOW = new Date("2026-09-24T12:00:00Z");
const config = { allowedOrigins: parseAllowedOrigins(`${ORIGIN}/, https://Other.example.com`), ipHashSalt: "salt" };
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";

let uuidCounter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`;

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    visitor_id: "11111111-1111-4111-8111-111111111111",
    session_id: "22222222-2222-4222-8222-222222222222",
    type: "page_view",
    source: "tracker",
    occurred_at: NOW.getTime() - 1000,
    url: `${ORIGIN}/?utm_source=google&utm_medium=cpc`,
    referrer: "https://www.google.com/",
    ...overrides,
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://app.example.com/api/collect", {
    method: "POST",
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      origin: ORIGIN,
      "user-agent": BROWSER_UA,
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let stored: EventRow[];
let log: ReturnType<typeof vi.fn<(message: string, detail?: unknown) => void>>;
let deps: CollectDeps;

beforeEach(() => {
  stored = [];
  log = vi.fn<(message: string, detail?: unknown) => void>();
  deps = { config, ingest: async (rows) => void stored.push(...rows), now: () => NOW, log };
});

describe("POST /api/collect", () => {
  it("stores a single event with parsed source fields, hashed IP and CORS header", async () => {
    const e = event();
    const res = await handleCollect(request(e), deps);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: e.id,
      path: "/",
      utm_source: "google",
      utm_medium: "cpc",
      referrer: "https://www.google.com/",
      is_touchpoint: true,
      user_agent: BROWSER_UA,
      ip_hash: hashIp("203.0.113.7", "salt"),
      occurred_at: new Date(NOW.getTime() - 1000).toISOString(),
    });
    expect(JSON.stringify(stored[0])).not.toContain("203.0.113.7");
  });

  it("stores a batch", async () => {
    const res = await handleCollect(request({ events: [event(), event({ type: "checkout_started" })] }), deps);
    expect(res.status).toBe(204);
    expect(stored.map((r) => r.type)).toEqual(["page_view", "checkout_started"]);
  });

  it("rejects batches over the limit as invalid", async () => {
    const res = await handleCollect(request({ events: Array.from({ length: 21 }, () => event()) }), deps);
    expect(res.status).toBe(204);
    expect(stored).toHaveLength(0);
  });

  it("passes duplicate event IDs through to ingest, which ignores them", async () => {
    // Deduplication happens in ingest_events (ON CONFLICT DO NOTHING); see ingest.test.ts.
    const e = event();
    await handleCollect(request(e), deps);
    await handleCollect(request(e), deps);
    expect(stored.map((r) => r.id)).toEqual([e.id, e.id]);
  });

  it("rejects an oversized body by content-length and by actual size", async () => {
    const big = JSON.stringify({ ...event(), referrer: "x".repeat(MAX_BODY_BYTES) });
    expect((await handleCollect(request(big, { "content-length": String(big.length) }), deps)).status).toBe(413);
    expect((await handleCollect(request(big), deps)).status).toBe(413);
    const fromEvil = await handleCollect(request(big, { origin: "https://evil.example" }), deps);
    expect(fromEvil.headers.get("access-control-allow-origin")).toBeNull();
    expect(stored).toHaveLength(0);
  });

  it("rejects a disallowed or missing origin", async () => {
    expect((await handleCollect(request(event(), { origin: "https://evil.example" }), deps)).status).toBe(403);
    const noOrigin = request(event());
    noOrigin.headers.delete("origin");
    expect((await handleCollect(noOrigin, deps)).status).toBe(403);
    expect(stored).toHaveLength(0);
  });

  it("matches origins case-insensitively and ignores a configured trailing slash", async () => {
    const res = await handleCollect(
      request(event({ url: "https://other.example.com/" }), { origin: "https://OTHER.example.com" }),
      deps,
    );
    expect(res.status).toBe(204);
    expect(stored).toHaveLength(1);
  });

  it("accepts the pixel sandbox's null origin only for pixel events", async () => {
    const pixel = event({ source: "pixel", type: "checkout_started", checkout_token: "tok_1" });
    expect((await handleCollect(request(pixel, { origin: "null" }), deps)).status).toBe(204);
    expect((await handleCollect(request(event(), { origin: "null" }), deps)).status).toBe(403);
    expect(stored.map((r) => r.checkout_token)).toEqual(["tok_1"]);
  });

  it("drops an invalid payload with 204 and logs only the failing paths", async () => {
    const res = await handleCollect(request({ ...event(), visitor_id: "secret-not-a-uuid" }), deps);
    expect(res.status).toBe(204);
    expect(stored).toHaveLength(0);
    expect(log).toHaveBeenCalledWith("collect: invalid payload", ["visitor_id"]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-not-a-uuid");
  });

  it("drops a body that isn't JSON", async () => {
    expect((await handleCollect(request("{nope"), deps)).status).toBe(204);
    expect(stored).toHaveLength(0);
  });

  it("parses JSON sent as text/plain (sendBeacon) and as application/json", async () => {
    await handleCollect(request(event()), deps);
    await handleCollect(request(event(), { "content-type": "application/json" }), deps);
    expect(stored).toHaveLength(2);
  });

  it("ignores bots", async () => {
    const res = await handleCollect(request(event(), { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }), deps);
    expect(res.status).toBe(204);
    expect(stored).toHaveLength(0);
  });

  it("replaces a client timestamp that is more than 24h off with server time", async () => {
    await handleCollect(request(event({ occurred_at: "2020-01-01T00:00:00Z" })), deps);
    expect(stored[0].occurred_at).toBe(NOW.toISOString());
  });

  it("marks internal navigation as not a touchpoint", async () => {
    await handleCollect(request(event({ url: `${ORIGIN}/products/tee`, referrer: `${ORIGIN}/` })), deps);
    expect(stored[0]).toMatchObject({ is_touchpoint: false, referrer: null, utm_source: null });
  });

  it("lets ingest errors surface so they show up in logs", async () => {
    deps.ingest = async () => {
      throw new Error("db down");
    };
    await expect(handleCollect(request(event()), deps)).rejects.toThrow("db down");
  });
});

describe("OPTIONS /api/collect", () => {
  const preflight = (origin: string) =>
    handleCollectPreflight(new Request("https://app.example.com/api/collect", { method: "OPTIONS", headers: { origin } }), config);

  it("allows configured origins and the pixel sandbox", async () => {
    for (const origin of [ORIGIN, "null"]) {
      const res = preflight(origin);
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    }
  });

  it("refuses other origins", () => {
    const res = preflight("https://evil.example");
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("originMatches", async () => {
  const { originMatches } = await import("@/lib/collect");
  const allowed = ["https://cashmerebrown.com", "https://*.lovable.app"];
  it("allows exact origins and subdomains of wildcard entries", () => {
    expect(originMatches("https://cashmerebrown.com", allowed)).toBe(true);
    expect(originMatches("https://low-end-bundle.lovable.app", allowed)).toBe(true);
    expect(originMatches("https://a.b.lovable.app", allowed)).toBe(true);
  });
  it("rejects look-alikes, the bare parent and other schemes", () => {
    expect(originMatches("https://lovable.app", allowed)).toBe(false);
    expect(originMatches("https://evil-lovable.app", allowed)).toBe(false);
    expect(originMatches("https://x.lovable.app.evil.com", allowed)).toBe(false);
    expect(originMatches("http://x.lovable.app", allowed)).toBe(false);
    expect(originMatches("https://shop.cashmerebrown.com", allowed)).toBe(false);
  });
});
