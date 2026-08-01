-- Smart Route compatibility for production databases whose visit_status enum has no `missed` value.
-- The existing PL/pgSQL functions parse the enum literal at execution time. Recreate their
-- stored definitions with status text comparison so both older and newer schemas work.
do $$
declare
  function_name regprocedure;
  definition text;
begin
  foreach function_name in array array[
    'public.apply_employee_smart_route(uuid,uuid[],uuid[],text,double precision,double precision,integer)'::regprocedure,
    'public.restore_employee_smart_route(uuid,integer)'::regprocedure
  ] loop
    definition := pg_get_functiondef(function_name);
    definition := replace(
      definition,
      'and v.status not in (''cancelled'',''missed'');',
      'and v.status::text not in (''cancelled'',''missed'');'
    );
    definition := replace(
      definition,
      'AND v.status <> ALL (ARRAY[''cancelled''::visit_status, ''missed''::visit_status])',
      'AND v.status::text <> ALL (ARRAY[''cancelled''::text, ''missed''::text])'
    );
    execute definition;
  end loop;
end
$$;
