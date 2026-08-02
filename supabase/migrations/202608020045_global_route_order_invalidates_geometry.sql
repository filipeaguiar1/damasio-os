-- Make canonical Visit order the single global route source.
-- When a route-changing event occurs, never leave the previous geometry available
-- while the asynchronous map rebuild is pending.

create or replace function public.queue_route_map_rebuild(
  p_route_id uuid,
  p_company_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_route_id is null or p_company_id is null then return; end if;

  insert into public.route_map_rebuild_queue(
    route_id,company_id,reason,attempts,requested_at,locked_at,last_error
  ) values (
    p_route_id,p_company_id,p_reason,0,now(),null,null
  )
  on conflict(route_id) do update set
    company_id=excluded.company_id,
    reason=excluded.reason,
    attempts=0,
    requested_at=excluded.requested_at,
    locked_at=null,
    last_error=null;

  insert into public.route_map_cache(
    route_id,company_id,geometry,bounds,distance_meters,duration_seconds,
    points_hash,status,provider,error_message,rebuilt_at,updated_at
  ) values (
    p_route_id,p_company_id,null,null,null,null,
    '','pending',null,null,null,now()
  )
  on conflict(route_id) do update set
    company_id=excluded.company_id,
    geometry=null,
    bounds=null,
    distance_meters=null,
    duration_seconds=null,
    points_hash='',
    status='pending',
    provider=null,
    error_message=null,
    rebuilt_at=null,
    updated_at=now();
end;
$$;

-- Remove any stale geometry that is currently marked pending and ensure those
-- routes are rebuilt from the canonical visits.route_order sequence.
update public.route_map_cache
set geometry=null,
    bounds=null,
    distance_meters=null,
    duration_seconds=null,
    points_hash='',
    provider=null,
    error_message=null,
    rebuilt_at=null,
    updated_at=now()
where status='pending';

insert into public.route_map_rebuild_queue(
  route_id,company_id,reason,attempts,requested_at,locked_at,last_error
)
select c.route_id,c.company_id,'canonical_order_changed',0,now(),null,null
from public.route_map_cache c
where c.status='pending'
on conflict(route_id) do update set
  company_id=excluded.company_id,
  reason=excluded.reason,
  attempts=0,
  requested_at=excluded.requested_at,
  locked_at=null,
  last_error=null;
