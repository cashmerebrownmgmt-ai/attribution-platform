import { createHash } from "node:crypto";
import { z } from "zod";
import { isTouchpoint, parseSource, type SourceFields } from "./source";

/** Request handling for POST /api/collect. Database access is injected so this stays testable. */

export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_BATCH = 20;
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|facebookexternalhit|preview|pingdom|monitor/i;

const text = (max: number) => z.string().trim().max(max);

const incomingEvent = z.object({
  id: z.uuid(),
  visitor_id: z.uuid(),
  session_id: z.uuid().optional(),
  type: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  source: z.enum(["tracker", "pixel"]),
  occurred_at: z.union([z.number().int().positive(), z.iso.datetime({ offset: true })]),
  url: z.url().max(2048),
  referrer: text(2048).nullish(),
  checkout_token: text(128).nullish(),
  shopify_order_id: text(64).nullish(),
});

const batch = z.object({ events: z.array(incomingEvent).min(1).max(MAX_BATCH) });

/** Accept either `{ events: [...] }` or a bare event. Picking the shape up front keeps error paths precise. */
function parsePayload(json: unknown) {
  const isBatch = typeof json === "object" && json !== null && "events" in json;
  return isBatch ? batch.safeParse(json) : incomingEvent.transform((e) => ({ events: [e] })).safeParse(json);
}

export type IncomingEvent = z.infer<typeof incomingEvent>;

export type EventRow = SourceFields & {
  id: string;
  visitor_id: string;
  session_id: string | null;
  type: string;
  source: "tracker" | "pixel";
  occurred_at: string;
  url: string;
  path: string;
  checkout_token: string | null;
  shopify_order_id: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  is_touchpoint: boolean;
};

export type CollectConfig = {
  /** Normalized origins (scheme + host, no trailing slash) allowed to send events. */
  allowedOrigins: string[];
  ipHashSalt: string;
};

export type CollectDeps = {
  config: CollectConfig;
  /** Persist a batch of events (and their visitors). */
  ingest: (rows: EventRow[]) => Promise<void>;
  now?: () => Date;
  log?: (message: string, detail?: unknown) => void;
};

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((o) => o.trim().toLowerCase().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function hashIp(ip: string | null, salt: string): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || null;
}

/** Client clocks can't be trusted: fall back to server time when they're more than 24h off. */
function clampTime(value: number | string, now: Date): string {
  const t = typeof value === "number" ? value : Date.parse(value);
  return Math.abs(t - now.getTime()) > MAX_CLOCK_SKEW_MS ? now.toISOString() : new Date(t).toISOString();
}

/**
 * Shopify's custom-pixel sandbox is an opaque-origin iframe, so its requests arrive with
 * `Origin: null`. Accept that only for batches made up entirely of pixel events.
 */
function originAllowed(origin: string | null, events: IncomingEvent[] | null, config: CollectConfig): boolean {
  if (!origin) return false;
  if (origin === "null") return events !== null && events.every((e) => e.source === "pixel");
  return config.allowedOrigins.includes(origin.toLowerCase());
}

function corsHeaders(origin: string | null): HeadersInit {
  return origin
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : { Vary: "Origin" };
}

export function toRow(e: IncomingEvent, req: Request, deps: CollectDeps, now: Date): EventRow {
  const storeHosts = deps.config.allowedOrigins.map((o) => o.replace(/^https?:\/\//, ""));
  const source = parseSource(e.url, e.referrer ?? null, storeHosts);
  return {
    ...source,
    id: e.id,
    visitor_id: e.visitor_id,
    session_id: e.session_id ?? null,
    type: e.type,
    source: e.source,
    occurred_at: clampTime(e.occurred_at, now),
    url: e.url,
    path: new URL(e.url).pathname,
    checkout_token: e.checkout_token ?? null,
    shopify_order_id: e.shopify_order_id ?? null,
    user_agent: req.headers.get("user-agent")?.slice(0, 512) ?? null,
    ip_hash: hashIp(clientIp(req), deps.config.ipHashSalt),
    is_touchpoint: isTouchpoint(source),
  };
}

export function handleCollectPreflight(req: Request, config: CollectConfig): Response {
  const origin = req.headers.get("origin");
  // Preflight never carries the body, so allow the pixel's opaque origin here too.
  const ok = origin === "null" || originAllowed(origin, null, config);
  return new Response(null, {
    status: ok ? 204 : 403,
    headers: ok
      ? {
          ...corsHeaders(origin),
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        }
      : { Vary: "Origin" },
  });
}

export async function handleCollect(req: Request, deps: CollectDeps): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  const log = deps.log ?? ((m, d) => console.warn(m, d));
  const origin = req.headers.get("origin");
  // Echo the origin only if it could be allowed; the pixel check needs the parsed body, so "null" passes here.
  const echo = origin === "null" || originAllowed(origin, null, deps.config) ? origin : null;
  const done = (status: number) => new Response(null, { status, headers: corsHeaders(echo) });

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return done(413);
  const body = await req.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return done(413);

  // sendBeacon posts text/plain to skip the CORS preflight, so parse JSON regardless of content type.
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  const parsed = parsePayload(json);
  const events = parsed.success ? parsed.data.events : null;

  if (!originAllowed(origin, events, deps.config)) {
    return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  }
  if (!events) {
    // Log where validation failed, never the payload itself.
    log("collect: invalid payload", parsed.error?.issues.map((i) => i.path.join(".") || "(root)"));
    return done(204);
  }
  if (BOT_UA.test(req.headers.get("user-agent") ?? "")) return done(204);

  await deps.ingest(events.map((e) => toRow(e, req, deps, now)));
  return done(204);
}
