-- Keep Employee canonical route behavior unchanged. Only Manager actors receive
-- module-specific checks before changing canonical route state.

begin;

do $$
declare
  v_def text;
  v_new text;
  v_old text;
  v_replacement text;
begin
  select pg_get_functiondef('public.apply_canonical_route_order_v2(uuid,uuid[],text,double precision,double precision,integer,text)'::regprocedure) into v_def;
  v_old:=E'end if;\r\n\r\n  select *\r\n  into v_route';
  v_replacement:=E'end if;\r\n\r\n  if v_profile.role::text = ''manager'' then\r\n    perform public.require_company_module_permission(''routes'',''manage'');\r\n  end if;\r\n\r\n  select *\r\n  into v_route';
  v_new:=replace(v_def,v_old,v_replacement);
  if v_new=v_def then raise exception 'canonical route permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.move_canonical_visits_v1(uuid[],uuid,uuid,text)'::regprocedure) into v_def;
  v_old:=E'end if;\n\n  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);';
  v_replacement:=E'end if;\n\n  if v_profile.role::text = ''manager''\n     and not public.company_module_permission_allowed(''dispatch'',''manage'')\n     and not public.company_module_permission_allowed(''routes'',''manage'') then\n    raise exception ''Manager Dispatch or Routes manage permission is required.'';\n  end if;\n\n  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);';
  v_new:=replace(v_def,v_old,v_replacement);
  if v_new=v_def then raise exception 'canonical move permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.remove_visits_from_today_route(uuid[],text)'::regprocedure) into v_def;
  v_old:=E'end if;\n\n  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);';
  v_replacement:=E'end if;\n\n  if v_profile.role::text = ''manager'' then\n    perform public.require_company_module_permission(''routes'',''manage'');\n  end if;\n\n  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);';
  v_new:=replace(v_def,v_old,v_replacement);
  if v_new=v_def then raise exception 'remove route permission anchor missing'; end if;
  execute v_new;
end
$$;

commit;
