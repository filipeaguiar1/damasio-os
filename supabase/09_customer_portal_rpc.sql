-- Damasio OS V42.5 - Customer Portal + Feedback
-- Run after supabase/08_scheduling_dispatch_rpc.sql.
-- Customer portal reads only one customer property in this demo phase.
-- Future RLS will replace the demo customer selector with authenticated profile ownership.

create or replace function public.get_demo_customer_property()
returns table(customer_id uuid, property_id uuid)
language sql
security definer
set search_path = public
as $$
  select c.id, p.id
  from customers c
  join properties p on p.customer_id = c.id
  where c.organization_id = '00000000-0000-0000-0000-000000000001'
  order by c.created_at asc, p.created_at asc
  limit 1;
$$;

grant execute on function public.get_demo_customer_property() to anon, authenticated;

create or replace function public.get_customer_portal_board()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with demo as (select * from public.get_demo_customer_property())
  select jsonb_build_object(
    'property', coalesce((
      select jsonb_build_object(
        'customerId', c.id,
        'propertyId', p.id,
        'customerName', c.full_name,
        'email', c.email,
        'phone', c.phone,
        'address', p.address_line1,
        'city', p.city,
        'province', p.province,
        'postalCode', p.postal_code,
        'lotSize', p.lot_size,
        'grassHeight', p.grass_height,
        'gate', p.gate,
        'dog', p.dog,
        'irrigation', p.irrigation,
        'accessNotes', p.access_notes,
        'propertyNotes', p.property_notes
      )
      from demo d
      join customers c on c.id = d.customer_id
      join properties p on p.id = d.property_id
    ), 'null'::jsonb),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'serviceName', coalesce(j.service_name, 'Service Visit'),
        'status', v.status::text,
        'scheduledDate', v.scheduled_date,
        'crewName', cr.name,
        'address', p.address_line1,
        'propertyId', v.property_id,
        'customerVisibleSummary', v.customer_visible_summary,
        'employeeNotes', v.employee_notes,
        'durationSeconds', v.duration_seconds,
        'startedAt', v.started_at,
        'finishedAt', v.finished_at,
        'createdAt', v.created_at
      ) order by v.scheduled_date desc, v.created_at desc)
      from demo d
      join visits v on v.customer_id = d.customer_id and v.property_id = d.property_id
      left join jobs j on j.id = v.job_id
      left join properties p on p.id = v.property_id
      left join crews cr on cr.id = v.crew_id
      where v.organization_id = '00000000-0000-0000-0000-000000000001'
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'customerIssue', t.customer_issue,
        'priority', t.priority::text,
        'status', t.status::text,
        'scheduledDate', t.scheduled_date,
        'address', p.address_line1,
        'propertyId', t.property_id,
        'resolvedAt', t.resolved_at,
        'completionSummary', t.completion_summary,
        'createdAt', t.created_at
      ) order by t.created_at desc)
      from demo d
      join tasks t on t.customer_id = d.customer_id and t.property_id = d.property_id
      left join properties p on p.id = t.property_id
      where t.organization_id = '00000000-0000-0000-0000-000000000001'
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sr.id,
        'serviceName', sr.service_name,
        'message', sr.message,
        'status', sr.status,
        'address', p.address_line1,
        'createdAt', sr.created_at
      ) order by sr.created_at desc)
      from demo d
      join service_requests sr on sr.customer_id = d.customer_id and sr.property_id = d.property_id
      left join properties p on p.id = sr.property_id
      where sr.organization_id = '00000000-0000-0000-0000-000000000001'
    ), '[]'::jsonb),
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id,
        'quoteNumber', q.quote_number,
        'status', q.status::text,
        'serviceName', coalesce(sr.service_name, q.notes, 'Service Quote'),
        'address', p.address_line1,
        'subtotal', q.subtotal,
        'tax', q.tax,
        'total', q.total,
        'notes', q.notes,
        'createdAt', q.created_at
      ) order by q.created_at desc)
      from demo d
      join quotes q on q.customer_id = d.customer_id and q.property_id = d.property_id
      left join service_requests sr on sr.id = q.request_id
      left join properties p on p.id = q.property_id
      where q.organization_id = '00000000-0000-0000-0000-000000000001'
    ), '[]'::jsonb),
    'feedback', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'rating', f.rating,
        'comment', f.comment,
        'visitId', f.visit_id,
        'taskId', f.task_id,
        'createdAt', f.created_at
      ) order by f.created_at desc)
      from demo d
      join feedback f on f.customer_id = d.customer_id and f.property_id = d.property_id
      where f.organization_id = '00000000-0000-0000-0000-000000000001'
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.get_customer_portal_board() to anon, authenticated;

create or replace function public.create_customer_portal_request(
  p_service_name text,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_customer uuid;
  v_property uuid;
  v_request uuid;
begin
  select customer_id, property_id into v_customer, v_property from public.get_demo_customer_property();
  if v_customer is null or v_property is null then raise exception 'Customer property not found'; end if;

  insert into service_requests (organization_id, customer_id, property_id, service_name, message, status)
  values (v_org, v_customer, v_property, nullif(trim(p_service_name), ''), nullif(trim(coalesce(p_message, '')), ''), 'pending')
  returning id into v_request;

  insert into activity_log (organization_id, action, entity_type, entity_id, details)
  values (v_org, 'Customer requested service', 'service_request', v_request, coalesce(p_service_name, 'Service request'));

  return public.get_customer_portal_board();
end;
$$;

grant execute on function public.create_customer_portal_request(text, text) to anon, authenticated;

create or replace function public.submit_customer_portal_feedback(
  p_visit_id uuid default null,
  p_task_id uuid default null,
  p_rating integer default 5,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_customer uuid;
  v_property uuid;
  v_feedback uuid;
  v_task uuid;
begin
  select customer_id, property_id into v_customer, v_property from public.get_demo_customer_property();
  if v_customer is null or v_property is null then raise exception 'Customer property not found'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1 to 5'; end if;

  insert into feedback (organization_id, customer_id, property_id, visit_id, task_id, rating, comment)
  values (v_org, v_customer, v_property, p_visit_id, p_task_id, p_rating, nullif(trim(coalesce(p_comment, '')), ''))
  returning id into v_feedback;

  insert into activity_log (organization_id, action, entity_type, entity_id, details)
  values (v_org, 'Customer submitted feedback', 'feedback', v_feedback, 'Rating: ' || p_rating::text || '.');

  if p_rating <= 3 and nullif(trim(coalesce(p_comment, '')), '') is not null then
    insert into tasks (organization_id, customer_id, property_id, source_visit_id, title, customer_issue, priority, status)
    values (v_org, v_customer, v_property, p_visit_id, 'Customer feedback follow-up', p_comment, 'urgent', 'open')
    returning id into v_task;

    insert into activity_log (organization_id, action, entity_type, entity_id, details)
    values (v_org, 'Created return visit from feedback', 'task', v_task, p_comment);
  end if;

  return public.get_customer_portal_board();
end;
$$;

grant execute on function public.submit_customer_portal_feedback(uuid, uuid, integer, text) to anon, authenticated;
