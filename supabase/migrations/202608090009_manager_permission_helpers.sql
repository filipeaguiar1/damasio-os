-- Canonical Manager permission resolver. Admin/Master retain full company
-- access; Manager obeys profiles.manager_permissions none/view/manage levels.

begin;

create or replace function public.company_module_permission_allowed(
  p_module text,
  p_required text default 'view'
)
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_role text;
  v_permissions jsonb;
  v_actual text;
  v_actual_rank integer;
  v_required_rank integer;
begin
  if auth.role()='service_role' then return true; end if;

  select p.role::text,coalesce(p.manager_permissions,'{}'::jsonb)
  into v_role,v_permissions
  from public.profiles p
  where p.id=auth.uid() and p.active
  limit 1;

  if v_role is null then return false; end if;
  if v_role in ('admin','master') then return true; end if;
  if v_role <> 'manager' then return false; end if;

  if p_module not in (
    'customers','properties','quotes','jobs','schedule','dispatch','routes',
    'employees','tasks','feedback','reports','finance','settings'
  ) then return false; end if;
  if p_required not in ('view','manage') then return false; end if;

  v_actual:=lower(coalesce(v_permissions->>p_module,'none'));
  v_actual_rank:=case v_actual when 'manage' then 2 when 'view' then 1 else 0 end;
  v_required_rank:=case p_required when 'manage' then 2 else 1 end;
  return v_actual_rank>=v_required_rank;
end;
$$;

create or replace function public.require_company_module_permission(
  p_module text,
  p_required text default 'view'
)
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
begin
  if not public.company_module_permission_allowed(p_module,p_required) then
    raise exception 'Manager % % permission is required.',initcap(p_module),p_required;
  end if;
  return true;
end;
$$;

revoke execute on function public.company_module_permission_allowed(text,text) from public,anon;
revoke execute on function public.require_company_module_permission(text,text) from public,anon;
grant execute on function public.company_module_permission_allowed(text,text) to authenticated,service_role;
grant execute on function public.require_company_module_permission(text,text) to authenticated,service_role;

commit;
