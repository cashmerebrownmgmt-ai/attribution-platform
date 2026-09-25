import { z } from "zod";
import { hashEmail } from "./privacy";

/** Admin API version used for webhooks subscriptions and the backfill. Change it only here. */
export const SHOPIFY_API_VERSION = "2026-07";

const id = z.union([z.number(), z.string()]).transform(String);
const money = z.union([z.string(), z.number()]).transform(String).nullish();
const str = z.string().nullish();

/** The fields we use from a REST-format order webhook payload. Everything else is ignored. */
export const orderPayload = z.object({
  id,
  name: str,
  created_at: z.string(),
  updated_at: str,
  total_price: money,
  subtotal_price: money,
  currency: str,
  financial_status: str,
  cancelled_at: str,
  checkout_token: str,
  cart_token: str,
  email: str,
  contact_email: str,
  customer: z.object({ id, email: str }).nullish(),
  landing_site: str,
  referring_site: str,
  source_name: str,
  note_attributes: z.array(z.object({ name: z.string(), value: z.unknown() })).nullish(),
  line_items: z
    .array(
      z.object({
        id,
        title: z.string(),
        variant_title: str,
        sku: str,
        quantity: z.number().int().nullish(),
        price: money,
        product_id: id.nullish(),
        variant_id: id.nullish(),
      }),
    )
    .nullish(),
});

export type OrderItemRow = {
  line_id: string;
  product_id: string | null;
  variant_id: string | null;
  title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  price: string | null;
};

export function toItemRows(o: OrderPayload): OrderItemRow[] {
  return (o.line_items ?? []).map((l) => ({
    line_id: l.id,
    product_id: l.product_id ?? null,
    variant_id: l.variant_id ?? null,
    title: l.title,
    variant_title: l.variant_title ?? null,
    sku: l.sku ?? null,
    quantity: l.quantity ?? 1,
    price: l.price ?? null,
  }));
}

export type OrderPayload = z.infer<typeof orderPayload>;

export type OrderRow = {
  id: string;
  name: string | null;
  created_at: string;
  total_price: string | null;
  subtotal_price: string | null;
  currency: string | null;
  financial_status: string | null;
  cancelled_at: string | null;
  checkout_token: string | null;
  cart_token: string | null;
  customer_id: string | null;
  email_hash: string | null;
  landing_site: string | null;
  referring_site: string | null;
  source_name: string | null;
  note_attributes: { name: string; value: string }[];
  ingested_via: "webhook" | "backfill";
  shopify_updated_at: string | null;
};

export function toOrderRow(o: OrderPayload, via: OrderRow["ingested_via"]): OrderRow {
  return {
    id: o.id,
    name: o.name ?? null,
    created_at: o.created_at,
    total_price: o.total_price ?? null,
    subtotal_price: o.subtotal_price ?? null,
    currency: o.currency ?? null,
    financial_status: o.financial_status ?? null,
    cancelled_at: o.cancelled_at ?? null,
    checkout_token: o.checkout_token ?? null,
    cart_token: o.cart_token ?? null,
    customer_id: o.customer?.id ?? null,
    email_hash: hashEmail(o.email ?? o.contact_email ?? o.customer?.email),
    landing_site: o.landing_site ?? null,
    referring_site: o.referring_site ?? null,
    source_name: o.source_name ?? null,
    note_attributes: (o.note_attributes ?? []).map((a) => ({ name: a.name, value: String(a.value ?? "") })),
    ingested_via: via,
    shopify_updated_at: o.updated_at ?? null,
  };
}

/** Topics that carry a full order payload. */
export const ORDER_TOPICS = new Set(["orders/create", "orders/updated", "orders/paid", "orders/cancelled"]);
export const PRIVACY_TOPICS = new Set(["customers/data_request", "customers/redact", "shop/redact"]);
