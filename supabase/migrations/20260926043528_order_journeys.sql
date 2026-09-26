-- order_journeys: Shopify's own record of each order's first and last visit (customerJourneySummary),
-- used to attribute orders our tracking didn't match. Visits are trimmed before storage: UTMs, click
-- IDs, the landing path and the referrer's domain only (no full URLs, no personal data).

create table public.order_journeys (
  order_id           text primary key references public.orders (id) on delete cascade,
  ready              boolean not null default false,  -- Shopify finished computing the journey
  days_to_conversion integer,
  moments            integer,
  first_visit        jsonb,
  last_visit         jsonb,
  fetched_at         timestamptz not null default now()
);

create index order_journeys_fetched_idx on public.order_journeys (fetched_at desc);

alter table public.order_journeys enable row level security;
