-- Damasio OS V42.3 - Quotes workflow
-- Run after supabase/06_operations_rpc.sql.
-- Approving a quote now creates the operational chain: Quote -> Job -> Tasks -> Activity History.

create or replace function public.set_operation_quote_status(
  p_quote_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_quote quotes%rowtype;
  v_job uuid;
begin
  if p_status not in ('draft','sent','approved','declined','expired') then
    raise exception 'Invalid quote status';
  end if;

  update quotes set status = p_status::quote_status
  where id = p_quote_id and organization_id = v_org
  returning * into v_quote;

  if v_quote.id is null then
    raise exception 'Quote not found';
  end if;

  insert into activity_log (organization_id, action, entity_type, entity_id, details)
  values (v_org, 'Updated quote status', 'quote', v_quote.id, 'Quote ' || v_quote.quote_number || ' changed to ' || p_status || '.');

  if p_status = 'approved' and not exists (select 1 from jobs where quote_id = v_quote.id and organization_id = v_org) then
    insert into jobs (organization_id, customer_id, property_id, quote_id, service_name, frequency, active, next_visit_date)
    values (v_org, v_quote.customer_id, v_quote.property_id, v_quote.id, coalesce(nullif(v_quote.notes, ''), 'Approved Service'), 'one_time', true, current_date + 1)
    returning id into v_job;

    insert into tasks (organization_id, customer_id, property_id, title, customer_issue, priority, status, scheduled_date)
    values
      (v_org, v_quote.customer_id, v_quote.property_id, 'Schedule first visit', 'Quote approved. Confirm the first service date with the customer.', 'normal', 'open', current_date + 1),
      (v_org, v_quote.customer_id, v_quote.property_id, 'Prepare crew checklist', 'Review quote notes, property access and service expectations before dispatch.', 'normal', 'open', current_date + 1);

    insert into activity_log (organization_id, action, entity_type, entity_id, details)
    values
      (v_org, 'Created job from approved quote', 'job', v_job, 'Job created from quote ' || v_quote.quote_number || '.'),
      (v_org, 'Created workflow tasks', 'quote', v_quote.id, 'First visit and crew preparation tasks created automatically.');
  end if;

  return public.get_operations_board();
end;
$$;

grant execute on function public.set_operation_quote_status(uuid, text) to anon, authenticated;
