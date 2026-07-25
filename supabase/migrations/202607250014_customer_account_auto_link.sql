-- Automatically link a signed-in customer to the customer record created by a quote/invitation.
-- Company assignment remains optional; this only links identity and customer data.
begin;

create or replace function public.link_current_customer_account()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt()->>'email', '')));
  v_customer_id uuid;
begin
  if v_user_id is null or v_email = '' then
    raise exception 'Authenticated customer email required';
  end if;

  select id into v_customer_id
  from public.customers
  where profile_id = v_user_id
    and archived_at is null
  order by created_at desc
  limit 1;

  if v_customer_id is not null then
    return v_customer_id;
  end if;

  select id into v_customer_id
  from public.customers
  where lower(trim(coalesce(email, ''))) = v_email
    and archived_at is null
    and (profile_id is null or profile_id = v_user_id)
  order by created_at desc
  limit 1
  for update;

  if v_customer_id is null then
    return null;
  end if;

  update public.customers
  set profile_id = v_user_id
  where id = v_customer_id
    and (profile_id is null or profile_id = v_user_id);

  update public.profiles
  set role = 'customer',
      active = true,
      email = coalesce(email, v_email)
  where id = v_user_id;

  update public.quote_invitations
  set status = 'claimed',
      claimed_by = v_user_id,
      claimed_at = coalesce(claimed_at, now())
  where lower(trim(email)) = v_email
    and status in ('pending', 'sent');

  return v_customer_id;
end;
$$;

revoke all on function public.link_current_customer_account() from public, anon;
grant execute on function public.link_current_customer_account() to authenticated;

create or replace function public.get_customer_portal_board()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_property_id uuid;
  v_result jsonb;
begin
  v_customer_id := public.link_current_customer_account();

  if v_customer_id is null then
    return jsonb_build_object(
      'property', null,
      'visits', '[]'::jsonb,
      'tasks', '[]'::jsonb,
      'requests', '[]'::jsonb,
      'quotes', '[]'::jsonb,
      'feedback', '[]'::jsonb
    );
  end if;

  select p.id
  into v_property_id
  from public.properties p
  where p.customer_id = v_customer_id
  order by p.created_at
  limit 1;

  select jsonb_build_object(
    'property', (
      select jsonb_build_object(
        'customerId', c.id,
        'propertyId', coalesce(p.id::text, ''),
        'customerName', c.full_name,
        'email', c.email,
        'phone', c.phone,
        'address', coalesce(p.address_line1, ''),
        'city', coalesce(p.city, ''),
        'province', coalesce(p.province, ''),
        'postalCode', p.postal_code,
        'lotSize', p.lot_size,
        'grassHeight', p.grass_height,
        'gate', coalesce(p.gate, false),
        'dog', coalesce(p.dog, false),
        'irrigation', coalesce(p.irrigation, false),
        'accessNotes', p.access_notes,
        'propertyNotes', p.property_notes
      )
      from public.customers c
      left join public.properties p on p.id = v_property_id
      where c.id = v_customer_id
    ),
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
      from public.visits v
      left join public.jobs j on j.id = v.job_id
      left join public.properties p on p.id = v.property_id
      left join public.crews cr on cr.id = v.crew_id
      where v.customer_id = v_customer_id
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
      from public.tasks t
      left join public.properties p on p.id = t.property_id
      where t.customer_id = v_customer_id
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
      from public.service_requests sr
      left join public.properties p on p.id = sr.property_id
      where sr.customer_id = v_customer_id
    ), '[]'::jsonb),
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', qu.id,
        'quoteNumber', qu.quote_number,
        'status', qu.status::text,
        'serviceName', coalesce(sr.service_name, qu.notes, 'Service Quote'),
        'address', p.address_line1,
        'subtotal', qu.subtotal,
        'tax', qu.tax,
        'total', qu.total,
        'notes', qu.notes,
        'createdAt', qu.created_at
      ) order by qu.created_at desc)
      from public.quotes qu
      left join public.service_requests sr on sr.id = qu.request_id
      left join public.properties p on p.id = qu.property_id
      where qu.customer_id = v_customer_id
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
      from public.feedback f
      where f.customer_id = v_customer_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_customer_portal_board() from public, anon;
grant execute on function public.get_customer_portal_board() to authenticated;

commit;
