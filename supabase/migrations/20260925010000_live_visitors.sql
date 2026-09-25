-- Live visitors: coarse location (from Vercel's edge geolocation), device class and page title.
-- Only city/region/country are kept; IP addresses are never stored (they're hashed, as before).
alter table public.events add column country text;   -- ISO 3166-1 alpha-2, e.g. "US"
alter table public.events add column region text;    -- e.g. "NY"
alter table public.events add column city text;
alter table public.events add column device text check (device in ('mobile', 'tablet', 'desktop'));
alter table public.events add column title text;

create index events_received_at_idx on public.events (received_at desc);

-- Same as before, plus the new columns.
create or replace function public.ingest_events(p_events jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted integer;
begin
  insert into public.visitors as v (id, first_seen_at, last_seen_at, first_touch)
  select
    visitor_id,
    min(occurred_at),
    max(occurred_at),
    (array_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'event_id', id, 'occurred_at', occurred_at, 'referrer', referrer,
        'utm_source', utm_source, 'utm_medium', utm_medium, 'utm_campaign', utm_campaign,
        'utm_term', utm_term, 'utm_content', utm_content,
        'gclid', gclid, 'fbclid', fbclid, 'ttclid', ttclid, 'msclkid', msclkid))
      order by occurred_at
    ) filter (where is_touchpoint))[1]
  from jsonb_populate_recordset(null::public.events, p_events)
  group by visitor_id
  on conflict (id) do update set
    first_seen_at = least(v.first_seen_at, excluded.first_seen_at),
    last_seen_at  = greatest(v.last_seen_at, excluded.last_seen_at),
    first_touch   = coalesce(v.first_touch, excluded.first_touch);

  insert into public.events (
    id, visitor_id, session_id, type, source, occurred_at, url, path, referrer,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    gclid, fbclid, ttclid, msclkid, checkout_token, shopify_order_id,
    user_agent, ip_hash, is_touchpoint, country, region, city, device, title
  )
  select
    id, visitor_id, session_id, type, source, occurred_at, url, path, referrer,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    gclid, fbclid, ttclid, msclkid, checkout_token, shopify_order_id,
    user_agent, ip_hash, coalesce(is_touchpoint, false), country, region, city, device, title
  from jsonb_populate_recordset(null::public.events, p_events)
  on conflict (id) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke execute on function public.ingest_events(jsonb) from public, anon, authenticated;
