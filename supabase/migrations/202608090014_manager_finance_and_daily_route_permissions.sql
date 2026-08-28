-- Complete Manager authorization for billing contracts and daily route publication.

begin;

do $$
declare
  v_def text;
  v_new text;
  v_old text;
  v_replacement text;
begin
  select pg_get_functiondef('public.get_payments_contract_workspace(text)'::regprocedure) into v_def;
  v_old:=E'  if p_scope = ''company''\n     and v_profile.role::text not in (''admin'',''manager'')\n  then\n    raise exception ''Company admin access required'';\n  end if;\n\n  return jsonb_build_object';
  v_replacement:=E'  if p_scope = ''company''\n     and v_profile.role::text not in (''admin'',''manager'')\n  then\n    raise exception ''Company admin access required'';\n  end if;\n\n  if p_scope = ''company'' and v_profile.role::text = ''manager'' then\n    perform public.require_company_module_permission(''finance'',''view'');\n  end if;\n\n  return jsonb_build_object';
  v_new:=replace(v_def,v_old,v_replacement);
  if v_new=v_def then raise exception 'payments workspace permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.save_customer_billing_agreement(uuid,text,text,text,bigint,bigint,integer,date,date,integer,text,integer,integer,integer,text)'::regprocedure) into v_def;
  v_old:=E'  if v_profile.id is null then\n    raise exception ''Authentication required'';\n  end if;\n\n  select *';
  v_replacement:=E'  if v_profile.id is null then\n    raise exception ''Authentication required'';\n  end if;\n\n  if v_profile.role::text = ''manager'' then\n    perform public.require_company_module_permission(''finance'',''manage'');\n  end if;\n\n  select *';
  v_new:=replace(v_def,v_old,v_replacement);
  if v_new=v_def then raise exception 'save billing agreement permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.generate_agreement_visits(uuid,date)'::regprocedure) into v_def;
  v_old:=E'  select *\n  into v_agreement\n  from public.billing_agreements';
  v_replacement:=E'  if v_profile.role::text = ''manager'' then\n    perform public.require_company_module_permission(''finance'',''manage'');\n  end if;\n\n  select *\n  into v_agreement\n  from public.billing_agreements';
  v_new:=replace(v_def,v_old,v_replacement);
  if v_new=v_def then raise exception 'generate agreement visits permission anchor missing'; end if;
  execute v_new;

  select pg_get_functiondef('public.publish_canonical_route_daily_v1(uuid,uuid,date,uuid[],uuid[])'::regprocedure) into v_def;
  v_old:=E'  if not found or v_profile.role::text not in (''admin'',''manager'',''master'') then\n    raise exception ''Only an active Admin can publish canonical routes.'';\n  end if;\n\n  v_company_id';
  v_replacement:=E'  if not found or v_profile.role::text not in (''admin'',''manager'',''master'') then\n    raise exception ''Only an active Admin can publish canonical routes.'';\n  end if;\n\n  if v_profile.role::text = ''manager'' then\n    perform public.require_company_module_permission(''routes'',''manage'');\n  end if;\n\n  v_company_id';
  v_new:=replace(v_def,v_old,v_replacement);
  if v_new=v_def then raise exception 'daily route publish permission anchor missing'; end if;
  execute v_new;
end
$$;

commit;
