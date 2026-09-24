-- Shopify webhook processing helpers. See docs/phase-1-spec.md §5.

-- Shopify's own last-modified time, so an older delivery (or a backfill) never overwrites newer data.
alter table public.orders add column shopify_updated_at timestamptz;

-- claim_webhook: record a delivery and say whether to process it.
-- True for a new delivery, and for a retry of one that failed or never finished;
-- false for a delivery already processed successfully.
create function public.claim_webhook(p_webhook_id text, p_topic text, p_shop_domain text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  done timestamptz;
begin
  insert into public.webhook_events (webhook_id, topic, shop_domain)
  values (p_webhook_id, p_topic, p_shop_domain)
  on conflict (webhook_id) do nothing;

  select processed_at into done from public.webhook_events where webhook_id = p_webhook_id;
  return done is null;
end;
$$;

-- upsert_order: insert or update an order from Shopify, keeping whichever version is newest.
-- Stitching columns (visitor_id, stitch_method) are never touched here.
-- A webhook row is never replaced by a backfill of the same version.
create function public.upsert_order(p_order jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.orders;
begin
  r := jsonb_populate_record(null::public.orders, p_order);

  insert into public.orders as o (
    id, name, created_at, total_price, subtotal_price, currency, financial_status, cancelled_at,
    checkout_token, cart_token, customer_id, email_hash, landing_site, referring_site, source_name,
    note_attributes, ingested_via, shopify_updated_at, updated_at
  ) values (
    r.id, r.name, r.created_at, r.total_price, r.subtotal_price, r.currency, r.financial_status, r.cancelled_at,
    r.checkout_token, r.cart_token, r.customer_id, r.email_hash, r.landing_site, r.referring_site, r.source_name,
    coalesce(r.note_attributes, '[]'::jsonb), r.ingested_via, r.shopify_updated_at, now()
  )
  on conflict (id) do update set
    name               = excluded.name,
    total_price        = excluded.total_price,
    subtotal_price     = excluded.subtotal_price,
    currency           = excluded.currency,
    financial_status   = excluded.financial_status,
    cancelled_at       = excluded.cancelled_at,
    checkout_token     = coalesce(excluded.checkout_token, o.checkout_token),
    cart_token         = coalesce(excluded.cart_token, o.cart_token),
    customer_id        = coalesce(excluded.customer_id, o.customer_id),
    email_hash         = coalesce(excluded.email_hash, o.email_hash),
    landing_site       = coalesce(excluded.landing_site, o.landing_site),
    referring_site     = coalesce(excluded.referring_site, o.referring_site),
    source_name        = excluded.source_name,
    note_attributes    = excluded.note_attributes,
    ingested_via       = case when o.ingested_via = 'webhook' then 'webhook' else excluded.ingested_via end,
    shopify_updated_at = excluded.shopify_updated_at,
    updated_at         = now()
  where o.shopify_updated_at is null
     or excluded.shopify_updated_at > o.shopify_updated_at
     or (excluded.shopify_updated_at = o.shopify_updated_at and excluded.ingested_via = 'webhook');
end;
$$;

revoke execute on function public.claim_webhook(text, text, text) from public, anon, authenticated;
revoke execute on function public.upsert_order(jsonb) from public, anon, authenticated;

-- redact_customer (customers/redact): strip the customer's identifiers from their orders.
-- Orders are kept for revenue totals but can no longer be tied to the person.
create function public.redact_customer(p_customer_id text, p_email_hash text, p_order_ids text[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.orders
     set customer_id = null, email_hash = null, updated_at = now()
   where id = any(coalesce(p_order_ids, '{}'))
      or (p_customer_id is not null and customer_id = p_customer_id)
      or (p_email_hash is not null and email_hash = p_email_hash);
$$;

-- redact_shop (shop/redact, sent 48h after the app is uninstalled): delete all store data.
-- The webhook log is kept so the redaction itself stays auditable.
create function public.redact_shop()
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.order_attributions where true;
  delete from public.orders where true;
  delete from public.events where true;
  delete from public.visitors where true;
$$;

revoke execute on function public.redact_customer(text, text, text[]) from public, anon, authenticated;
revoke execute on function public.redact_shop() from public, anon, authenticated;
