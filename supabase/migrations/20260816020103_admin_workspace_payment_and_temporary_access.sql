create table if not exists public.temporary_test_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  created_by_master_id uuid not null references public.profiles(id) on delete restrict,
  company_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('admin','customer','employee')),
  email text not null,
  display_name text not null,
  customer_id uuid references public.customers(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  expires_at timestamptz,
  disabled_at timestamptz,
  disabled_reason text,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > created_at)
);

create index if not exists temporary_test_accounts_company_created
  on public.temporary_test_accounts(company_id, created_at desc);
create index if not exists temporary_test_accounts_expiry
  on public.temporary_test_accounts(expires_at)
  where disabled_at is null and expires_at is not null;
create unique index if not exists temporary_test_accounts_active_email
  on public.temporary_test_accounts(lower(email))
  where disabled_at is null;

alter table public.temporary_test_accounts enable row level security;
revoke all on public.temporary_test_accounts from public, anon, authenticated;
grant all privileges on public.temporary_test_accounts to service_role;

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(p.company_id,p.organization_id)
  from public.profiles p
  where p.id=auth.uid()
    and p.active
    and not exists(
      select 1
      from public.temporary_test_accounts t
      where t.auth_user_id=p.id
        and t.disabled_at is null
        and t.expires_at is not null
        and t.expires_at<=now()
    )
  limit 1
$$;

create or replace function public.deactivate_expired_temporary_test_accounts()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count integer:=0;
begin
  with expired as (
    update public.temporary_test_accounts t
       set disabled_at=clock_timestamp(),
           disabled_reason=coalesce(t.disabled_reason,'expired')
     where t.disabled_at is null
       and t.expires_at is not null
       and t.expires_at<=clock_timestamp()
     returning t.auth_user_id,t.employee_id
  ), profiles_disabled as (
    update public.profiles p
       set active=false
     where p.id in (select auth_user_id from expired)
     returning p.id
  ), employees_disabled as (
    update public.employees e
       set active=false
     where e.id in (select employee_id from expired where employee_id is not null)
     returning e.id
  )
  select count(*)::integer into v_count from expired;
  return v_count;
end;
$$;

revoke all on function public.deactivate_expired_temporary_test_accounts() from public,anon,authenticated;
grant execute on function public.deactivate_expired_temporary_test_accounts() to service_role;

create or replace function public.disable_temporary_test_account(p_account_id uuid,p_reason text default 'disabled_by_master')
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.temporary_test_accounts%rowtype;
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'Service role required';
  end if;

  select * into v_row
  from public.temporary_test_accounts
  where id=p_account_id
  for update;
  if v_row.id is null then return false; end if;

  update public.temporary_test_accounts
     set disabled_at=coalesce(disabled_at,clock_timestamp()),
         disabled_reason=coalesce(nullif(trim(coalesce(p_reason,'')),''),'disabled_by_master')
   where id=v_row.id;
  update public.profiles set active=false where id=v_row.auth_user_id;
  if v_row.employee_id is not null then
    update public.employees set active=false where id=v_row.employee_id;
  end if;
  return true;
end;
$$;

revoke all on function public.disable_temporary_test_account(uuid,text) from public,anon,authenticated;
grant execute on function public.disable_temporary_test_account(uuid,text) to service_role;

create or replace function public.get_admin_task_properties()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_company uuid;
begin
  select coalesce(p.company_id,p.organization_id)
    into v_company
  from public.profiles p
  where p.id=auth.uid()
    and p.active
    and p.role::text in ('admin','manager')
  limit 1;
  if v_company is null then raise exception 'Admin or Manager access required'; end if;

  return coalesce((
    select jsonb_agg(row_data order by customer_name,address_line1)
    from (
      select jsonb_build_object(
        'id',p.id,
        'customerId',c.id,
        'customerName',c.full_name,
        'customerEmail',c.email,
        'address',p.address_line1,
        'city',p.city,
        'province',p.province,
        'postalCode',p.postal_code,
        'photoUrl',p.official_photo_url
      ) row_data,
      c.full_name customer_name,
      p.address_line1
      from public.properties p
      join public.customers c on c.id=p.customer_id and c.archived_at is null
      where coalesce(p.company_id,p.organization_id)=v_company
        and (
          (coalesce(c.platform_managed,false)=false and c.acquisition_source<>'platform' and coalesce(c.company_id,c.organization_id)=v_company)
          or
          ((coalesce(c.platform_managed,false)=true or c.acquisition_source='platform')
            and c.service_company_id=v_company
            and c.offer_status='accepted'
            and coalesce(c.assignment_status,'') in ('accepted','assigned','active'))
        )
    ) q
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.get_admin_task_properties() from public,anon;
grant execute on function public.get_admin_task_properties() to authenticated,service_role;

create or replace function public.get_admin_alert_center()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_company uuid;
begin
  select coalesce(p.company_id,p.organization_id)
    into v_company
  from public.profiles p
  where p.id=auth.uid()
    and p.active
    and p.role::text in ('admin','manager')
  limit 1;
  if v_company is null then raise exception 'Admin or Manager access required'; end if;

  return jsonb_build_object(
    'tasks',coalesce((
      select jsonb_agg(item order by urgent_order,created_at desc)
      from (
        select jsonb_build_object(
          'id',t.id,'customerId',t.customer_id,'propertyId',t.property_id,
          'customerName',c.full_name,'address',p.address_line1,
          'title',t.title,'detail',t.customer_issue,'status',t.status::text,
          'priority',t.priority::text,'scheduledDate',t.scheduled_date,'createdAt',t.created_at
        ) item,
        case when t.priority::text='urgent' then 0 else 1 end urgent_order,
        t.created_at
        from public.tasks t
        join public.customers c on c.id=t.customer_id
        join public.properties p on p.id=t.property_id
        where coalesce(t.company_id,t.organization_id)=v_company
          and t.status::text<>'resolved'
        order by urgent_order,t.created_at desc
        limit 250
      ) s
    ),'[]'::jsonb),
    'payments',coalesce((
      select jsonb_agg(item order by created_at desc)
      from (
        select jsonb_build_object(
          'id',i.id,'customerId',i.customer_id,'propertyId',i.property_id,
          'customerName',c.full_name,'address',p.address_line1,
          'number',i.invoice_number,'status',i.status::text,
          'total',i.total,'createdAt',i.created_at
        ) item,i.created_at
        from public.invoices i
        join public.customers c on c.id=i.customer_id
        left join public.properties p on p.id=i.property_id
        where i.organization_id=v_company
          and i.status::text in ('sent','waiting_payment','processing','overdue')
        order by i.created_at desc
        limit 250
      ) s
    ),'[]'::jsonb),
    'feedback',coalesce((
      select jsonb_agg(item order by created_at desc)
      from (
        select jsonb_build_object(
          'id',f.id,'customerId',f.customer_id,'propertyId',f.property_id,
          'customerName',c.full_name,'address',p.address_line1,
          'rating',f.rating,'comment',f.comment,'visitId',f.visit_id,'taskId',f.task_id,'createdAt',f.created_at
        ) item,f.created_at
        from public.feedback f
        join public.customers c on c.id=f.customer_id
        left join public.properties p on p.id=f.property_id
        where coalesce(f.company_id,f.organization_id)=v_company
          and coalesce(f.rating,5)<=3
          and f.created_at>=now()-interval '180 days'
        order by f.created_at desc
        limit 250
      ) s
    ),'[]'::jsonb),
    'visits',coalesce((
      select jsonb_agg(item order by scheduled_date desc)
      from (
        select jsonb_build_object(
          'id',v.id,'customerId',v.customer_id,'propertyId',v.property_id,
          'customerName',c.full_name,'address',p.address_line1,
          'scheduledDate',v.scheduled_date,'status',v.status::text,
          'category',case
            when v.status::text='completed' then 'completed'
            when v.status::text='scheduled' and v.scheduled_date<current_date then 'overdue'
            when v.status::text='scheduled' and (v.route_id is not null or v.assigned_employee_id is not null or v.crew_id is not null) then 'booked'
            when v.status::text='scheduled' then 'upcoming'
            else 'active'
          end,
          'createdAt',v.created_at
        ) item,v.scheduled_date
        from public.visits v
        join public.customers c on c.id=v.customer_id
        left join public.properties p on p.id=v.property_id
        where coalesce(v.company_id,v.organization_id)=v_company
          and v.status::text<>'cancelled'
          and (
            (v.status::text='completed' and v.scheduled_date>=current_date-30)
            or (v.status::text<>'completed' and v.scheduled_date between current_date-90 and current_date+45)
          )
        order by v.scheduled_date desc
        limit 500
      ) s
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_admin_alert_center() from public,anon;
grant execute on function public.get_admin_alert_center() to authenticated,service_role;

create or replace function public.get_payments_contract_workspace(p_scope text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_is_master boolean;
  v_company uuid;
begin
  select * into v_profile
  from public.profiles
  where id=auth.uid() and active=true;
  if v_profile.id is null then raise exception 'Authentication required'; end if;

  v_is_master:=v_profile.role::text='master';
  v_company:=coalesce(v_profile.company_id,v_profile.organization_id);

  if p_scope='master' and not v_is_master then raise exception 'Master access required'; end if;
  if p_scope='company' and v_profile.role::text not in ('admin','manager') then raise exception 'Company admin access required'; end if;
  if p_scope not in ('master','company') then raise exception 'Invalid payment workspace scope'; end if;
  if p_scope='company' and v_company is null then raise exception 'Company context is required'; end if;
  if p_scope='company' and v_profile.role::text='manager' then
    perform public.require_company_module_permission('finance','view');
  end if;

  return jsonb_build_object(
    'customers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'name',c.full_name,'email',c.email,'origin',c.acquisition_source,
        'originCompanyId',c.origin_company_id,'serviceCompanyId',c.service_company_id,
        'assignmentStatus',c.assignment_status,'servicePaymentMethod',c.service_payment_method
      ) order by c.full_name)
      from public.customers c
      where c.archived_at is null and (
        (p_scope='master' and c.acquisition_source='platform')
        or
        (p_scope='company' and (
          (c.acquisition_source='platform' and c.service_company_id=v_company and c.offer_status='accepted' and coalesce(c.assignment_status,'') in ('accepted','assigned','active'))
          or
          (c.acquisition_source<>'platform' and coalesce(c.company_id,c.organization_id)=v_company)
        ))
      )
    ),'[]'::jsonb),
    'jobs',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',j.id,'customerId',j.customer_id,'propertyId',j.property_id,'serviceName',j.service_name,
        'nextVisitDate',j.next_visit_date,'active',j.active
      ) order by j.created_at desc)
      from public.jobs j
      join public.customers c on c.id=j.customer_id and c.archived_at is null
      where j.active=true and (
        (p_scope='master' and c.acquisition_source='platform')
        or
        (p_scope='company' and (
          (c.acquisition_source='platform' and c.service_company_id=v_company and c.offer_status='accepted' and coalesce(c.assignment_status,'') in ('accepted','assigned','active'))
          or
          (c.acquisition_source<>'platform' and coalesce(j.company_id,j.organization_id)=v_company)
        ))
      )
    ),'[]'::jsonb),
    'agreements',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',ba.id,'jobId',ba.job_id,'customerId',ba.customer_id,'customerOrigin',ba.customer_origin,
        'ownerRole',ba.contract_owner_role,'billingModel',ba.billing_model,'collectionTiming',ba.collection_timing,
        'serviceFrequency',ba.service_frequency,'customerAmountCents',ba.customer_amount_cents,
        'providerPayoutCents',ba.provider_payout_cents,'platformFeeBasisPoints',ba.platform_fee_basis_points,
        'contractStartsOn',ba.contract_starts_on,'contractEndsOn',ba.contract_ends_on,
        'feedbackWindowHours',ba.feedback_window_hours,'prepaidPlanType',ba.prepaid_plan_type,'active',ba.active
      ) order by ba.active desc,ba.created_at desc)
      from public.billing_agreements ba
      join public.customers c on c.id=ba.customer_id and c.archived_at is null
      where (p_scope='master' and c.acquisition_source='platform')
         or (p_scope='company' and ba.company_id=v_company)
    ),'[]'::jsonb),
    'events',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',be.id,'visitId',be.visit_id,'customerId',be.customer_id,
        'state',case when p_scope='company' and c.acquisition_source='platform' and be.state in ('charge_failed','payment_failed') then 'payout_pending' else be.state end,
        'feedbackDeadlineAt',be.feedback_deadline_at,'chargedAt',be.charged_at,'transferredAt',be.transferred_at
      ) order by be.created_at desc)
      from public.visit_billing_events be
      join public.customers c on c.id=be.customer_id and c.archived_at is null
      where (p_scope='master' and c.acquisition_source='platform')
         or (p_scope='company' and be.company_id=v_company)
    ),'[]'::jsonb),
    'invoices',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'customerId',i.customer_id,'propertyId',i.property_id,'number',i.invoice_number,
        'status',i.status::text,'totalCents',round(i.total*100)::bigint,'createdAt',i.created_at,
        'visitId',i.visit_id,'billingEventId',i.billing_event_id,
        'stripeCheckoutSessionId',i.stripe_checkout_session_id,'stripePaymentIntentId',i.stripe_payment_intent_id
      ) order by i.created_at desc)
      from public.invoices i
      join public.customers c on c.id=i.customer_id and c.archived_at is null
      where (p_scope='master' and c.acquisition_source='platform')
         or (p_scope='company' and i.organization_id=v_company and (
           (c.acquisition_source='platform' and c.service_company_id=v_company and c.offer_status='accepted' and coalesce(c.assignment_status,'') in ('accepted','assigned','active'))
           or (c.acquisition_source<>'platform' and coalesce(c.company_id,c.organization_id)=v_company)
         ))
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_payments_contract_workspace(text) from public,anon;
grant execute on function public.get_payments_contract_workspace(text) to authenticated,service_role;

do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='temporary-test-access-expiry' loop
    perform cron.unschedule(r.jobid);
  end loop;
  perform cron.schedule('temporary-test-access-expiry','* * * * *','select public.deactivate_expired_temporary_test_accounts();');
end $$;
