/**
 * Admin API access for a Dev Dashboard app on your own store: the client credentials grant swaps
 * the app's Client ID + secret for a token that lasts ~24h. No token is stored anywhere.
 */
import { SHOPIFY_API_VERSION } from "./shopify";

export type ShopifyCreds = { shop: string; clientId: string; clientSecret: string };
type Fetch = typeof fetch;

export function normalizeShop(shop: string): string {
  const s = shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) throw new Error("SHOPIFY_SHOP_DOMAIN must look like your-store.myshopify.com");
  return s;
}

export function adminClient(creds: ShopifyCreds, fetchImpl: Fetch = fetch) {
  const shop = normalizeShop(creds.shop);
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const res = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: creds.clientId, client_secret: creds.clientSecret }),
    });
    if (!res.ok) throw new Error(`Shopify token request failed (${res.status}). Check the Client ID/secret and that the app is installed on ${shop}.`);
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 86_400) * 1000 };
    return token.value;
  }

  async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetchImpl(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await accessToken() },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Shopify GraphQL request failed (${res.status})`);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(`Shopify GraphQL errors: ${body.errors.map((e) => e.message).join("; ")}`);
    return body.data as T;
  }

  return { shop, graphql };
}

// ─── Webhook subscriptions ────────────────────────────────────────────────────

export const WEBHOOK_TOPICS = ["ORDERS_CREATE", "ORDERS_UPDATED", "ORDERS_PAID", "ORDERS_CANCELLED", "REFUNDS_CREATE"] as const;

export type ExistingWebhook = { id: string; topic: string; uri: string };

/** Which topics still need a subscription to `uri` (idempotent: running setup twice changes nothing). */
export function webhooksToCreate(existing: ExistingWebhook[], uri: string, topics: readonly string[] = WEBHOOK_TOPICS): string[] {
  return topics.filter((t) => !existing.some((w) => w.topic === t && w.uri === uri));
}

export const Q_EXISTING = `query ExistingWebhooks {
  webhookSubscriptions(first: 50) { nodes { id topic uri } }
}`;

export const M_CREATE = `mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id topic uri }
    userErrors { field message }
  }
}`;

export const Q_SHOP = `query ShopInfo {
  shop { name myshopifyDomain primaryDomain { url } currencyCode }
}`;
