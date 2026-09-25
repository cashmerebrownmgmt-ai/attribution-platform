-- Match Shopify's sales numbers: revenue is the order total after refunds (current_total_price), and
-- Shopify test orders are left out of every dashboard number, as they are in Shopify's own reports.

alter table public.orders add column current_total_price numeric(12, 2);  -- total after refunds; null until known
alter table public.orders add column test boolean not null default false;

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
     or (excluded.shopify_updated_at = o.shopify_updated_at and excluded.ingested_via = 'webhook');
end;
$$;

revoke execute on function public.upsert_order(jsonb) from public, anon, authenticated;

create or replace view public.order_facts
with (security_invoker = true) as
select
  o.id,
  o.name,
  o.created_at,
  coalesce(o.current_total_price, o.total_price, 0)::numeric(12, 2) as revenue,
  o.currency,
  o.cancelled_at,
  o.stitch_method,
  o.visitor_id,
  -- First order for this customer (by customer ID, else email hash); unknown customers count as new.
  case
    when o.customer_id is null and o.email_hash is null then true
    else not exists (
      select 1 from public.orders p
      where p.id <> o.id
        and not p.test
        and p.created_at < o.created_at
        and ((o.customer_id is not null and p.customer_id = o.customer_id)
          or (o.email_hash is not null and p.email_hash = o.email_hash))
    )
  end as is_new_customer
from public.orders o
where not o.test;
