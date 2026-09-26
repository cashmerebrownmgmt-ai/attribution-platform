-- session_facts gains landing_host: the site a session started on (the store, or a landing page on
-- another domain such as Lovable), for the Sessions "Site" breakdown. The return type changes, so the
-- function is dropped and recreated.

drop function public.session_facts(timestamptz, timestamptz);

create function public.session_facts(p_from timestamptz, p_to timestamptz)
returns table (
  session_id uuid,
  visitor_id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  pageviews integer,
  landing_path text,
  landing_title text,
  exit_path text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  gclid text,
  fbclid text,
  ttclid text,
  msclkid text,
  referrer text,
  device text,
  country text,
  region text,
  city text,
  is_new_visitor boolean,
  added_to_cart boolean,
  reached_checkout boolean,
  completed_checkout boolean,
  landing_host text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (
    select e.session_id, e.visitor_id,
           min(e.occurred_at) as started_at,
           max(e.occurred_at) as ended_at,
           count(*) filter (where e.type = 'page_view')::int as pageviews,
           bool_or(e.type = 'add_to_cart') as added_to_cart
    from public.events e
    where e.source = 'tracker' and e.session_id is not null
      and e.occurred_at >= p_from and e.occurred_at < p_to
    group by e.session_id, e.visitor_id
  ),
  first_page as (
    select distinct on (e.session_id) e.session_id, e.path, e.title, e.device, e.country, e.region, e.city, e.url
    from public.events e join s on s.session_id = e.session_id
    where e.source = 'tracker' and e.type = 'page_view'
    order by e.session_id, e.occurred_at
  ),
  last_page as (
    select distinct on (e.session_id) e.session_id, e.path
    from public.events e join s on s.session_id = e.session_id
    where e.source = 'tracker' and e.type = 'page_view'
    order by e.session_id, e.occurred_at desc
  ),
  touch as (
    select distinct on (e.session_id) e.session_id, e.utm_source, e.utm_medium, e.utm_campaign,
           e.gclid, e.fbclid, e.ttclid, e.msclkid, e.referrer
    from public.events e join s on s.session_id = e.session_id
    where e.source = 'tracker' and e.is_touchpoint
    order by e.session_id, e.occurred_at
  )
  select
    s.session_id, s.visitor_id, s.started_at, s.ended_at, s.pageviews,
    fp.path, fp.title, lp.path,
    t.utm_source, t.utm_medium, t.utm_campaign, t.gclid, t.fbclid, t.ttclid, t.msclkid, t.referrer,
    fp.device, fp.country, fp.region, fp.city,
    coalesce(v.first_seen_at >= s.started_at - interval '1 second', true) as is_new_visitor,
    coalesce(s.added_to_cart, false),
    exists (
      select 1 from public.events p
      where p.visitor_id = s.visitor_id and p.source = 'pixel'
        and p.occurred_at between s.started_at and s.ended_at + interval '2 hours'
    ) as reached_checkout,
    exists (
      select 1 from public.events p
      where p.visitor_id = s.visitor_id and p.source = 'pixel' and p.type = 'checkout_completed'
        and p.occurred_at between s.started_at and s.ended_at + interval '2 hours'
    ) as completed_checkout,
    -- The site the session started on: the store, or a landing page on another domain.
    regexp_replace(lower(substring(fp.url from '^https?://([^/:?#]+)')), '^www\.', '') as landing_host
  from s
  left join first_page fp on fp.session_id = s.session_id
  left join last_page lp on lp.session_id = s.session_id
  left join touch t on t.session_id = s.session_id
  left join public.visitors v on v.id = s.visitor_id
  order by s.started_at;
$$;

revoke execute on function public.session_facts(timestamptz, timestamptz) from public, anon, authenticated;
