-- save_stitch: store an order's stitching result and replace its attribution rows atomically.
-- See docs/phase-1-spec.md §6.
create function public.save_stitch(p_order_id text, p_visitor_id uuid, p_method text, p_attributions jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.orders
     set visitor_id = p_visitor_id, stitch_method = p_method, updated_at = now()
   where id = p_order_id;

  delete from public.order_attributions where order_id = p_order_id;

  insert into public.order_attributions (order_id, model, event_id, channel, credit)
  select p_order_id, a.model, a.event_id, a.channel, a.credit
  from jsonb_to_recordset(p_attributions) as a(model text, event_id uuid, channel text, credit numeric);
end;
$$;

revoke execute on function public.save_stitch(text, uuid, text, jsonb) from public, anon, authenticated;
