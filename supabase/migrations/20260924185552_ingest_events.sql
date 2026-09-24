-- ingest_events: store a batch from /api/collect in one round trip.
-- Upserts each visitor (widening first/last seen, setting first_touch only once), then inserts
-- the events, silently skipping IDs already stored (clients may resend).
-- Called only by the server with the service role; see docs/phase-1-spec.md §2.

create function public.ingest_events(p_events jsonb)
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
    user_agent, ip_hash, is_touchpoint
  )
  select
    id, visitor_id, session_id, type, source, occurred_at, url, path, referrer,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    gclid, fbclid, ttclid, msclkid, checkout_token, shopify_order_id,
    user_agent, ip_hash, coalesce(is_touchpoint, false)
  from jsonb_populate_recordset(null::public.events, p_events)
  on conflict (id) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- Supabase grants EXECUTE on new functions to the public API roles by default; this one is server-only.
revoke execute on function public.ingest_events(jsonb) from public, anon, authenticated;
