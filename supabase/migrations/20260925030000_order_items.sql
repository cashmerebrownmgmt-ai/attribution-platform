-- Order line items, for product-level reporting (which kits/bundles sell, from which sources).
create table public.order_items (
  order_id      text not null references public.orders (id) on delete cascade,
  line_id       text not null,             -- Shopify line item ID
  product_id    text,
  variant_id    text,
  title         text not null,
  variant_title text,
  sku           text,
  quantity      integer not null default 1,
  price         numeric(12, 2),            -- unit price, before discounts
  primary key (order_id, line_id)
);
create index order_items_product_idx on public.order_items (coalesce(product_id, title));
alter table public.order_items enable row level security;

-- replace_order_items: the order's items become exactly this list (orders can be edited).
create function public.replace_order_items(p_order_id text, p_items jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.order_items where order_id = p_order_id;
  insert into public.order_items (order_id, line_id, product_id, variant_id, title, variant_title, sku, quantity, price)
  select p_order_id, i.line_id, i.product_id, i.variant_id, i.title, i.variant_title, i.sku, coalesce(i.quantity, 1), i.price
  from jsonb_to_recordset(p_items) as i(line_id text, product_id text, variant_id text, title text, variant_title text, sku text, quantity integer, price numeric)
  where i.line_id is not null and i.title is not null;
$$;

revoke execute on function public.replace_order_items(text, jsonb) from public, anon, authenticated;
