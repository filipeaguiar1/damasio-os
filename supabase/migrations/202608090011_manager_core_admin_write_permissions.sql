-- Protect customer archive, dispatch assignment and official route publication
-- with Manager module-specific manage permissions.

begin;

do $$
declare
  v_def text;
  v_new text;
  v_old text;
  v_replacement text;
begin
  select pg_get_functiondef('public.archive_company_customers(uuid[])'::regprocedure) into v_def;
  v_old:=E'begin\n  select coalesce(p.company_id,p.organization_id)';
  v_replacement:=E'begin\n  perform public.require_company_module_permission(''customers'',''manage'');\n  select coalesce(p.company_id,p.organization_id)';
  v_new:=replace(v_def,v_old,v_replacement);
  if v_new=v_def then raise exception 'archive customer permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.assign_job_to_crew(uuid,uuid)'::regprocedure) into v_def;
  v_old:=E'begin\n  select coalesce(p.company_id,p.organization_id)';
  v_replacement:=E'begin\n  perform public.require_company_module_permission(''dispatch'',''manage'');\n  select coalesce(p.company_id,p.organization_id)';
  v_new:=replace(v_def,v_old,v_replacement);
  if v_new=v_def then raise exception 'assign job permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.publish_official_route_stops(uuid,date,uuid[])'::regprocedure) into v_def;
  v_old:=E'begin\n  select coalesce(p.company_id,p.organization_id)';
  v_replacement:=E'begin\n  perform public.require_company_module_permission(''routes'',''manage'');\n  select coalesce(p.company_id,p.organization_id)';
  v_new:=replace(v_def,v_old,v_replacement);
  if v_new=v_def then raise exception 'publish route permission anchor missing'; end if;
  execute v_new;
end
$$;

commit;
