-- V53.1 Employee Route Safety
-- Hardens visit status changes so field actions are tenant-scoped, permission
-- checked and idempotent for repeated mobile taps/retries.

create or replace function public.can_manage_visit_status(p_visit_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  with actor as (
    select pr.id,pr.role::text role,coalesce(pr.company_id,pr.organization_id) company_id,
           e.id employee_id,e.crew_id
    from public.profiles pr
    left join public.employees e
      on e.profile_id=pr.id
      and e.active
      and coalesce(e.company_id,e.organization_id)=coalesce(pr.company_id,pr.organization_id)
    where pr.id=auth.uid() and pr.active
  )
  select exists(
    select 1
    from actor a
    join public.visits v on v.id=p_visit_id
    where coalesce(v.company_id,v.organization_id)=a.company_id
      and (
        a.role in ('admin','manager','master')
        or (a.role='employee' and (v.assigned_employee_id=a.employee_id or v.crew_id=a.crew_id))
      )
  )
$$;

create or replace function public.set_visit_dispatch_status(
  p_visit_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_visit public.visits%rowtype;
  v_company uuid;
  v_previous_status text;
  v_allowed_next text[];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status not in ('scheduled','in_progress','completed','missed','cancelled') then
    raise exception 'Invalid visit status';
  end if;

  select * into v_visit from public.visits where id=p_visit_id for update;
  if not found then raise exception 'Visit was not found'; end if;
  if not public.can_manage_visit_status(p_visit_id) then
    raise exception 'You do not have access to update this visit';
  end if;

  v_company := coalesce(v_visit.company_id,v_visit.organization_id);
  v_previous_status := v_visit.status::text;

  if v_previous_status=p_status then
    return public.get_scheduling_dispatch_board();
  end if;

  v_allowed_next := case v_previous_status
    when 'scheduled' then array['in_progress','completed','missed','cancelled']
    when 'in_progress' then array['completed','scheduled','missed']
    when 'completed' then array['scheduled']
    when 'missed' then array['scheduled','cancelled']
    when 'cancelled' then array['scheduled']
    else array[]::text[]
  end;

  if not p_status=any(v_allowed_next) then
    raise exception 'Invalid visit transition from % to %', v_previous_status, p_status;
  end if;

  update public.visits
  set status=p_status::visit_status,
      started_at=case
        when p_status='in_progress' and started_at is null then now()
        when p_status='scheduled' then null
        else started_at
      end,
      finished_at=case
        when p_status='completed' then now()
        when p_status='scheduled' then null
        else finished_at
      end,
      duration_seconds=case
        when p_status='completed' then greatest(0,extract(epoch from(now()-coalesce(started_at,now())))::integer)
        when p_status='scheduled' then null
        else duration_seconds
      end
  where id=p_visit_id;

  insert into public.activity_log(organization_id,company_id,actor_profile_id,action,entity_type,entity_id,details,metadata)
  values(
    v_company,
    v_company,
    auth.uid(),
    'visit.status_changed',
    'visit',
    p_visit_id,
    'Visit changed from '||v_previous_status||' to '||p_status||'.',
    jsonb_build_object('from',v_previous_status,'to',p_status,'visit_id',p_visit_id,'route_id',v_visit.route_id)
  );

  if v_visit.route_id is not null then
    perform public.queue_route_map_rebuild(v_visit.route_id,v_company,'visit_status_changed');
  end if;

  return public.get_scheduling_dispatch_board();
end;
$$;

revoke execute on function public.set_visit_dispatch_status(uuid,text) from public,anon;
grant execute on function public.set_visit_dispatch_status(uuid,text) to authenticated;

revoke execute on function public.can_manage_visit_status(uuid) from public,anon;
grant execute on function public.can_manage_visit_status(uuid) to authenticated;
