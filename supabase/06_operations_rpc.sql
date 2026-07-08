-- Damasio OS V42.2 - Operations bridge
-- Run this after 05_customer_property_rpc.sql.
-- Early controlled RPC API for Quotes, Jobs, Tasks and Activity History.

create or replace function public.get_operations_board()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id,
        'quoteNumber', q.quote_number,
        'status', q.status::text,
        'customerId', q.customer_id,
        'propertyId', q.property_id,
        'customerName', c.full_name,
        'address', p.address_line1,
        'serviceName', coalesce(sr.service_name, q.notes, 'Service Quote'),
        'subtotal', q.subtotal,
        'tax', q.tax,
        'total', q.total,
        'notes', q.notes,
        'createdAt', q.created_at
      ) order by q.created_at desc)
      from quotes q
      left join customers c on c.id = q.customer_id
      left join properties p on p.id = q.property_id
      left join service_requests sr on sr.id = q.request_id
      where q.organization_id = '00000000-0000-0000-0000-000000000001'
    ), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id,
        'serviceName', j.service_name,
        'frequency', j.frequency::text,
        'active', j.active,
        'nextVisitDate', j.next_visit_date,
        'customerName', c.full_name,
        'address', p.address_line1,
        'quoteId', j.quote_id,
        'propertyId', j.property_id,
        'createdAt', j.created_at
      ) order by j.created_at desc)
      from jobs j
      left join customers c on c.id = j.customer_id
      left join properties p on p.id = j.property_id
      where j.organization_id = '00000000-0000-0000-0000-000000000001'
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'customerIssue', t.customer_issue,
        'priority', t.priority::text,
        'status', t.status::text,
        'scheduledDate', t.scheduled_date,
        'customerName', c.full_name,
        'address', p.address_line1,
        'propertyId', t.property_id,
        'createdAt', t.created_at,
        'resolvedAt', t.resolved_at,
        'completionSummary', t.completion_summary
      ) order by t.created_at desc)
      from tasks t
      left join customers c on c.id = t.customer_id
      left join properties p on p.id = t.property_id
      where t.organization_id = '00000000-0000-0000-0000-000000000001'
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'action', a.action,
        'entityType', a.entity_type,
        'entityId', a.entity_id,
        'details', a.details,
        'createdAt', a.created_at
      ) order by a.created_at desc)
      from activity_log a
      where a.organization_id = '00000000-0000-0000-0000-000000000001'
      limit 50
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.get_operations_board() to anon, authenticated;

create or replace function public.create_operation_quote(
  p_customer_id uuid,
  p_property_id uuid,
  p_service_name text,
  p_subtotal numeric default 0,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_quote uuid;
  v_quote_number text;
  v_tax numeric(10,2);
  v_total numeric(10,2);
begin
  if p_customer_id is null or p_property_id is null then
    raise exception 'Customer and property are required';
  end if;

  v_quote_number := 'Q-' || to_char(now(), 'YYYYMMDD') || '-' || lpad((select (count(*) + 1)::text from quotes where organization_id = v_org), 4, '0');
  v_tax := round(coalesce(p_subtotal, 0) * 0.13, 2);
  v_total := round(coalesce(p_subtotal, 0) + v_tax, 2);

  insert into quotes (organization_id, customer_id, property_id, quote_number, status, subtotal, tax, total, notes)
  values (v_org, p_customer_id, p_property_id, v_quote_number, 'draft', coalesce(p_subtotal, 0), v_tax, v_total, nullif(trim(coalesce(p_notes, p_service_name)), ''))
  returning id into v_quote;

  insert into activity_log (organization_id, action, entity_type, entity_id, details)
  values (v_org, 'Created quote', 'quote', v_quote, coalesce(p_service_name, 'Service quote') || ' created.');

  return public.get_operations_board();
end;
$$;

grant execute on function public.create_operation_quote(uuid, uuid, text, numeric, text) to anon, authenticated;

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

  if v_quote.id is null then raise exception 'Quote not found'; end if;

  insert into activity_log (organization_id, action, entity_type, entity_id, details)
  values (v_org, 'Updated quote status', 'quote', v_quote.id, 'Quote ' || v_quote.quote_number || ' changed to ' || p_status || '.');

  if p_status = 'approved' and not exists (select 1 from jobs where quote_id = v_quote.id) then
    insert into jobs (organization_id, customer_id, property_id, quote_id, service_name, frequency, active)
    values (v_org, v_quote.customer_id, v_quote.property_id, v_quote.id, coalesce(v_quote.notes, 'Approved Service'), 'one_time', true)
    returning id into v_job;

    insert into activity_log (organization_id, action, entity_type, entity_id, details)
    values (v_org, 'Created job from approved quote', 'job', v_job, 'Job created from quote ' || v_quote.quote_number || '.');
  end if;

  return public.get_operations_board();
end;
$$;

grant execute on function public.set_operation_quote_status(uuid, text) to anon, authenticated;

create or replace function public.create_operation_task(
  p_customer_id uuid,
  p_property_id uuid,
  p_title text,
  p_customer_issue text,
  p_priority text default 'normal',
  p_scheduled_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_task uuid;
begin
  if p_priority not in ('low','normal','urgent') then p_priority := 'normal'; end if;

  insert into tasks (organization_id, customer_id, property_id, title, customer_issue, priority, status, scheduled_date)
  values (v_org, p_customer_id, p_property_id, trim(p_title), trim(p_customer_issue), p_priority::task_priority, 'open', p_scheduled_date)
  returning id into v_task;

  insert into activity_log (organization_id, action, entity_type, entity_id, details)
  values (v_org, 'Created task', 'task', v_task, trim(p_title));

  return public.get_operations_board();
end;
$$;

grant execute on function public.create_operation_task(uuid, uuid, text, text, text, date) to anon, authenticated;

create or replace function public.resolve_operation_task(
  p_task_id uuid,
  p_completion_summary text default 'Task resolved by Admin.'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
begin
  update tasks
  set status = 'resolved', resolved_at = now(), completion_summary = nullif(trim(coalesce(p_completion_summary, 'Task resolved.')), '')
  where id = p_task_id and organization_id = v_org;

  insert into activity_log (organization_id, action, entity_type, entity_id, details)
  values (v_org, 'Resolved task', 'task', p_task_id, coalesce(p_completion_summary, 'Task resolved.'));

  return public.get_operations_board();
end;
$$;

grant execute on function public.resolve_operation_task(uuid, text) to anon, authenticated;
