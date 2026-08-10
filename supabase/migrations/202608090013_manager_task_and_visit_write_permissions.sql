-- Manager task administration requires tasks:manage. Employee/Customer photo
-- rules and Employee Visit execution behavior remain unchanged.

begin;

do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.create_admin_task(uuid,text,text,text,date)'::regprocedure) into v_def;
  v_new:=replace(v_def,E'begin\r\n',E'begin\r\n  perform public.require_company_module_permission(''tasks'',''manage'');\r\n');
  if v_new=v_def then raise exception 'create_admin_task permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.assign_task(uuid,uuid,uuid,date)'::regprocedure) into v_def;
  v_new:=replace(v_def,E'begin\r\n',E'begin\r\n  perform public.require_company_module_permission(''tasks'',''manage'');\r\n');
  if v_new=v_def then raise exception 'assign_task permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.resolve_completed_task(uuid,text)'::regprocedure) into v_def;
  v_new:=replace(v_def,E'begin\r\n',E'begin\r\n  perform public.require_company_module_permission(''tasks'',''manage'');\r\n');
  if v_new=v_def then raise exception 'resolve_completed_task permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.unassign_task(uuid)'::regprocedure) into v_def;
  v_new:=replace(v_def,E'begin\r\n',E'begin\r\n  perform public.require_company_module_permission(''tasks'',''manage'');\r\n');
  if v_new=v_def then raise exception 'unassign_task permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.register_task_photo(uuid,text,text,text)'::regprocedure) into v_def;
  v_new:=replace(v_def,
    E'  select * into v_actor from profiles where id=auth.uid() and active;\r\n  select * into v_task',
    E'  select * into v_actor from profiles where id=auth.uid() and active;\r\n  if v_actor.role::text=''manager'' then\r\n    perform public.require_company_module_permission(''tasks'',''manage'');\r\n  end if;\r\n  select * into v_task');
  if v_new=v_def then raise exception 'register_task_photo permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.transition_visit_execution(uuid,text,text)'::regprocedure) into v_def;
  v_new:=replace(v_def,
    E'  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);\r\n',
    E'  if v_profile.role::text=''manager'' then\r\n    perform public.require_company_module_permission(''dispatch'',''manage'');\r\n  end if;\r\n\r\n  v_company_id := coalesce(v_profile.company_id, v_profile.organization_id);\r\n');
  if v_new=v_def then raise exception 'transition_visit_execution permission anchor missing'; end if;
  execute v_new;
end
$$;

commit;
