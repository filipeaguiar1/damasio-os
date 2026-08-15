-- Complete Manager read authorization across canonical route, operations,
-- dispatch, tasks, reports, photos and company data surfaces.

begin;

create or replace function public.employee_can_use_route(p_route_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.routes r
    left join public.employees e
      on e.profile_id=auth.uid()
      and e.active
      and coalesce(e.company_id,e.organization_id)=coalesce(r.company_id,r.organization_id)
    join public.profiles p on p.id=auth.uid() and p.active
    where r.id=p_route_id
      and coalesce(r.company_id,r.organization_id)=public.current_company_id()
      and (
        p.role::text in ('admin','master')
        or (p.role::text='manager' and public.company_module_permission_allowed('routes','view'))
        or (
          p.role::text='employee'
          and (
            r.crew_id=e.crew_id
            or exists (
              select 1 from public.visits v
              where v.route_id=r.id
                and v.assigned_employee_id=e.id
            )
          )
        )
      )
  );
$$;

create or replace function public.get_canonical_route_order_v2(p_route_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_route public.routes%rowtype;
  v_company_id uuid;
  v_version integer;
  v_order uuid[];
  v_role text;
begin
  select * into v_route from public.routes where id=p_route_id;
  if not found then raise exception 'Route not found.'; end if;

  v_company_id:=coalesce(v_route.company_id,v_route.organization_id);
  select role::text into v_role from public.profiles where id=auth.uid() and active limit 1;

  if not (
    (v_role='admin' and v_company_id=public.current_company_id())
    or (v_role='manager' and v_company_id=public.current_company_id() and public.company_module_permission_allowed('routes','view'))
    or (v_role='employee' and public.employee_can_use_route(p_route_id))
    or public.master_has_company_access(v_company_id,'read_only')
  ) then
    raise exception 'You do not have access to this route.';
  end if;

  select coalesce(array_agg(s.visit_id order by s.position),'{}'::uuid[])
  into v_order from public.route_stops s where s.route_id=p_route_id;

  select coalesce(state.version,1) into v_version
  from public.route_order_state state where state.route_id=p_route_id;

  return jsonb_build_object('routeId',p_route_id,'version',coalesce(v_version,1),'orderedVisitIds',v_order);
end;
$$;

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.company_canonical_integrity_report()'::regprocedure) into v_def;
  v_new:=replace(v_def,
    E'  return jsonb_build_object(',
    E'  if v_role=''manager'' then\n    perform public.require_company_module_permission(''reports'',''view'');\n  end if;\n\n  return jsonb_build_object(');
  if v_new=v_def then raise exception 'integrity report permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.get_live_daily_operations(date)'::regprocedure) into v_def;
  v_new:=replace(v_def,
    E'role::text in (''admin'',''manager'')',
    E'(role::text=''admin'' or (role::text=''manager'' and public.company_module_permission_allowed(''dispatch'',''view'') and public.company_module_permission_allowed(''tasks'',''view'')))');
  if v_new=v_def then raise exception 'daily operations read permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.get_live_task_board()'::regprocedure) into v_def;
  v_new:=replace(v_def,
    E'a.role in (''admin'',''manager'')',
    E'(a.role=''admin'' or (a.role=''manager'' and public.company_module_permission_allowed(''tasks'',''view'')))');
  if v_new=v_def then raise exception 'task board read permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.get_task_dispatch_workers()'::regprocedure) into v_def;
  v_new:=replace(v_def,
    E'role::text in (''admin'',''manager'')',
    E'(role::text=''admin'' or (role::text=''manager'' and public.company_module_permission_allowed(''tasks'',''view'')))');
  if v_new=v_def then raise exception 'task workers read permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.get_property_photo_history(uuid)'::regprocedure) into v_def;
  v_new:=replace(v_def,
    E'pr.role::text in (''admin'',''manager'',''master'')',
    E'(pr.role::text in (''admin'',''master'') or (pr.role::text=''manager'' and public.company_module_permission_allowed(''properties'',''view'')))');
  if v_new=v_def then raise exception 'photo history read permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.get_operations_board()'::regprocedure) into v_def;
  v_new:=replace(v_def,
    E'where public.require_active_company_operator();',
    E'where public.require_active_company_operator()\n    and public.company_module_permission_allowed(''jobs'',''view'')\n    and public.company_module_permission_allowed(''quotes'',''view'')\n    and public.company_module_permission_allowed(''tasks'',''view'');');
  if v_new=v_def then raise exception 'operations board permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.get_scheduling_dispatch_board()'::regprocedure) into v_def;
  v_new:=replace(v_def,
    E'where public.require_active_company_operator();',
    E'where public.require_active_company_operator()\n    and public.company_module_permission_allowed(''schedule'',''view'')\n    and public.company_module_permission_allowed(''dispatch'',''view'')\n    and public.company_module_permission_allowed(''tasks'',''view'');');
  if v_new=v_def then raise exception 'scheduling board permission anchor missing'; end if;
  execute v_new;
end
$$;

create or replace function public.get_company_dispatch_jobs()
returns jsonb
language sql
security definer
set search_path=public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',j.id,'serviceName',j.service_name,'frequency',j.frequency::text,
    'nextVisitDate',j.next_visit_date,'customerName',c.full_name,'address',p.address_line1,
    'propertyId',j.property_id,'customerId',j.customer_id,'quoteId',j.quote_id,
    'crewId',j.default_crew_id,'crewName',cr.name,'recurrenceAnchorDate',j.recurrence_anchor_date,
    'defaultRouteOrder',j.default_route_order,'createdAt',j.created_at
  ) order by c.full_name,p.address_line1),'[]'::jsonb)
  from public.jobs j
  join public.customers c on c.id=j.customer_id
  left join public.properties p on p.id=j.property_id
  left join public.crews cr on cr.id=j.default_crew_id
  where public.require_active_company_operator()
    and (
      public.company_module_permission_allowed('dispatch','view')
      or public.company_module_permission_allowed('jobs','view')
    )
    and coalesce(j.company_id,j.organization_id)=public.current_company_id()
    and j.active;
$$;

create or replace function public.get_company_referral_inbox()
returns jsonb
language sql
security definer
set search_path=public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'fullName',l.full_name,'email',l.email,'phone',l.phone,
    'address',l.address,'serviceRequested',l.service_requested,'notes',l.notes,
    'status',l.status,'createdAt',l.created_at
  ) order by l.created_at desc),'[]'::jsonb)
  from public.lead_center l
  where public.require_active_company_operator()
    and public.company_module_permission_allowed('customers','view')
    and l.assigned_company_id=public.current_company_id()
    and l.status in ('offered','accepted','declined','converted');
$$;

create or replace function public.get_customer_property_directory()
returns table(
  customer_id uuid,
  property_id uuid,
  full_name text,
  email text,
  phone text,
  customer_notes text,
  address_line1 text,
  city text,
  province text,
  postal_code text,
  lot_size text,
  grass_height text,
  gate boolean,
  dog boolean,
  irrigation boolean,
  access_notes text,
  property_notes text,
  official_photo_url text,
  created_at timestamptz
)
language sql
security definer
set search_path=public
as $$
  select c.id,p.id,c.full_name,c.email,c.phone,c.notes,
    p.address_line1,p.city,p.province,p.postal_code,p.lot_size::text,p.grass_height::text,
    p.gate,p.dog,p.irrigation,p.access_notes,p.property_notes,p.official_photo_url,p.created_at
  from public.customers c
  join public.properties p
    on p.customer_id=c.id
   and coalesce(p.company_id,p.organization_id)=coalesce(c.company_id,c.organization_id)
  where public.require_active_company_operator()
    and public.company_module_permission_allowed('customers','view')
    and coalesce(c.company_id,c.organization_id)=public.current_company_id()
    and c.archived_at is null
  order by p.created_at desc;
$$;

commit;
