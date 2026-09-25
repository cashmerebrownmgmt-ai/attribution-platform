-- Let a re-import fill the new order fields: an unchanged order (same Shopify updated_at) is still updated
-- when it lacks the total after refunds or Shopify now marks it as a test order.

create or replace function public.upsert_order(p_order jsonb)
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
    id, name, created_at, total_price, current_total_price, subtotal_price, currency, financial_status, cancelled_at, test,
    checkout_token, cart_token, customer_id, email_hash, landing_site, referring_site, source_name,
    note_attributes, ingested_via, shopify_updated_at, updated_at
  ) values (
    r.id, r.name, r.created_at, r.total_price, r.current_total_price, r.subtotal_price, r.currency, r.financial_status, r.cancelled_at, coalesce(r.test, false),
    r.checkout_token, r.cart_token, r.customer_id, r.email_hash, r.landing_site, r.referring_site, r.source_name,
    coalesce(r.note_attributes, '[]'::jsonb), r.ingested_via, r.shopify_updated_at, now()
  )
  on conflict (id) do update set
    name                = excluded.name,
    total_price         = excluded.total_price,
    current_total_price = coalesce(excluded.current_total_price, o.current_total_price),
    subtotal_price      = excluded.subtotal_price,
    currency            = excluded.currency,
    financial_status    = excluded.financial_status,
    cancelled_at        = excluded.cancelled_at,
    test                = excluded.test,
    checkout_token      = coalesce(excluded.checkout_token, o.checkout_token),
    cart_token          = coalesce(excluded.cart_token, o.cart_token),
    customer_id         = coalesce(excluded.customer_id, o.customer_id),
    email_hash          = coalesce(excluded.email_hash, o.email_hash),
    landing_site        = coalesce(excluded.landing_site, o.landing_site),
    referring_site      = coalesce(excluded.referring_site, o.referring_site),
    source_name         = excluded.source_name,
    note_attributes     = excluded.note_attributes,
    ingested_via        = case when o.ingested_via = 'webhook' then 'webhook' else excluded.ingested_via end,
    shopify_updated_at  = excluded.shopify_updated_at,
    updated_at          = now()
  where o.shopify_updated_at is null
     or excluded.shopify_updated_at > o.shopify_updated_at
     or (excluded.shopify_updated_at = o.shopify_updated_at and excluded.ingested_via = 'webhook')
     or (o.current_total_price is null and excluded.current_total_price is not null)
     or (excluded.test and not o.test);
end;
$$;

revoke execute on function public.upsert_order(jsonb) from public, anon, authenticated;
