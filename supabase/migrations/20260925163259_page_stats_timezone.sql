-- page_stats in the store's time zone: days are grouped by p_tz (default America/New_York) instead of UTC,
-- so Trend radar days match Shopify's.

drop function public.page_stats(timestamptz, timestamptz);

create function public.page_stats(p_from timestamptz, p_to timestamptz, p_tz text default 'America/New_York')
returns table (day date, kind text, key text, title text, views integer, sessions integer, carts integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with e as (
    select (e.occurred_at at time zone p_tz)::date as day, e.session_id, e.title,
           substring(lower(e.path) from '/products/([^/?#]+)') as product,
           substring(lower(e.path) from '^(?:/[a-z]{2}(?:-[a-z]{2})?)?/collections/([^/?#]+)/?$') as collection,
           case when lower(e.path) ~ '^(?:/[a-z]{2}(?:-[a-z]{2})?)?/search/?$'
                then lower(substring(e.url from '[?&]q=([^&#]*)')) end as search
    from public.events e
    where e.source = 'tracker' and e.type = 'page_view'
      and e.occurred_at >= p_from and e.occurred_at < p_to
  ),
  keyed as (
    select day, session_id, title, 'product'::text as kind, product as key from e where product is not null
    union all
    select day, session_id, title, 'collection', collection from e where collection is not null
    union all
    select day, session_id, null, 'search', search from e
    where search is not null and search <> '' and length(search) <= 120 and search !~ '(@|%40|[0-9]{7,})'
  ),
  carts as (
    select distinct e.session_id
    from public.events e
    where e.source = 'tracker' and e.type = 'add_to_cart' and e.session_id is not null
      and e.occurred_at >= p_from and e.occurred_at < p_to
  )
  select k.day, k.kind, k.key, max(k.title),
         count(*)::int,
         count(distinct k.session_id)::int,
         count(distinct k.session_id) filter (where c.session_id is not null)::int
  from keyed k left join carts c on c.session_id = k.session_id
  group by k.day, k.kind, k.key
  order by k.day, k.kind, k.key
$$;

revoke execute on function public.page_stats(timestamptz, timestamptz, text) from public, anon, authenticated;
