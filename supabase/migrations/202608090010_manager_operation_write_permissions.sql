-- Manager writes must obey the same module map configured by Admin.

begin;

do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.create_operation_quote(uuid,uuid,text,numeric,text)'::regprocedure) into v_def;
  v_new:=replace(v_def,'perform public.require_active_company_operator();','perform public.require_company_module_permission(''quotes'',''manage'');');
  if v_new=v_def then raise exception 'create_operation_quote permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.create_operation_task(uuid,uuid,text,text,text,date)'::regprocedure) into v_def;
  v_new:=replace(v_def,'perform public.require_active_company_operator();','perform public.require_company_module_permission(''tasks'',''manage'');');
  if v_new=v_def then raise exception 'create_operation_task permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.resolve_operation_task(uuid,text)'::regprocedure) into v_def;
  v_new:=replace(v_def,'perform public.require_active_company_operator();','perform public.require_company_module_permission(''tasks'',''manage'');');
  if v_new=v_def then raise exception 'resolve_operation_task permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.set_operation_quote_status(uuid,text)'::regprocedure) into v_def;
  v_new:=replace(v_def,'perform public.require_active_company_operator();','perform public.require_company_module_permission(''quotes'',''manage'');');
  if v_new=v_def then raise exception 'set_operation_quote_status permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.respond_company_referral(uuid,boolean)'::regprocedure) into v_def;
  v_new:=replace(v_def,'perform public.require_active_company_operator();','perform public.require_company_module_permission(''customers'',''manage'');');
  if v_new=v_def then raise exception 'respond_company_referral permission anchor missing'; end if;
  execute v_new;
end
$$;

commit;
