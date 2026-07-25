-- Separate commercial origin from the company currently servicing a customer.
-- A referral code records origin only. The Master assigns the servicing company later.
begin;

alter table public.customers
  add column if not exists acquisition_source text not null default 'platform'
    check (acquisition_source in ('platform','company_referral','company_created')),
  add column if not exists origin_company_id uuid references public.organizations(id) on delete set null,
  add column if not exists service_company_id uuid references public.organizations(id) on delete set null,
  add column if not exists referral_code_used text,
  add column if not exists assignment_status text not null default 'pending_payment'
    check (assignment_status in ('pending_payment','ready_for_assignment','assigned','paused','cancelled')),
  add column if not exists first_payment_at timestamptz,
  add column if not exists last_transfer_at timestamptz,
  add column if not exists last_transfer_reason text,
  add column if not exists previous_service_company_id uuid references public.organizations(id) on delete set null,
  add column if not exists previous_company_notified_at timestamptz;

alter table public.quotes
  add column if not exists acquisition_source text not null default 'platform'
    check (acquisition_source in ('platform','company_referral','company_created')),
  add column if not exists origin_company_id uuid references public.organizations(id) on delete set null,
  add column if not exists referral_code_used text;

-- Existing customers already linked operationally to a company keep that assignment.
update public.customers
set service_company_id = coalesce(service_company_id, company_id, organization_id),
    assignment_status = case
      when coalesce(service_company_id, company_id, organization_id) is not null then 'assigned'
      else assignment_status
    end
where service_company_id is null
  and coalesce(company_id, organization_id) is not null;

create index if not exists customers_assignment_status_idx
  on public.customers(assignment_status, created_at desc);
create index if not exists customers_origin_company_idx
  on public.customers(origin_company_id, created_at desc);
create index if not exists customers_service_company_idx
  on public.customers(service_company_id, created_at desc);
create index if not exists quotes_origin_company_idx
  on public.quotes(origin_company_id, created_at desc);

-- Resolve a referral code and preserve commercial origin without assigning service.
create or replace function public.apply_quote_company_origin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(new.referral_code_used, '')));
  v_company_id uuid;
begin
  if v_code = '' then
    return new;
  end if;

  select id into v_company_id
  from public.organizations
  where upper(coalesce(referral_code, '')) = v_code
    and active = true
    and deleted_at is null
  limit 1;

  if v_company_id is null then
    return new;
  end if;

  new.referral_code_used := v_code;
  new.acquisition_source := 'company_referral';
  new.origin_company_id := v_company_id;

  if new.customer_id is not null then
    update public.customers
    set acquisition_source = 'company_referral',
        origin_company_id = coalesce(origin_company_id, v_company_id),
        referral_code_used = coalesce(referral_code_used, v_code)
    where id = new.customer_id;
  end if;

  return new;
end;
$$;

drop trigger if exists quotes_apply_company_origin on public.quotes;
create trigger quotes_apply_company_origin
before insert or update of referral_code_used, customer_id
on public.quotes
for each row execute function public.apply_quote_company_origin();

-- Mark the customer as ready for Master assignment after the first successful payment.
create or replace function public.mark_customer_ready_after_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('paid','completed','succeeded')
     and coalesce(old.status, '') is distinct from new.status
     and new.customer_id is not null then
    update public.customers
    set first_payment_at = coalesce(first_payment_at, now()),
        assignment_status = case
          when service_company_id is not null then 'assigned'
          else 'ready_for_assignment'
        end
    where id = new.customer_id;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_mark_customer_ready on public.payments;
create trigger payments_mark_customer_ready
after insert or update of status
on public.payments
for each row execute function public.mark_customer_ready_after_payment();

-- Master-only transfer function. It changes service responsibility without erasing origin.
create or replace function public.master_transfer_customer(
  p_customer_id uuid,
  p_service_company_id uuid,
  p_reason text default null
)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_master public.profiles%rowtype;
  v_customer public.customers%rowtype;
begin
  select * into v_master from public.profiles where id = auth.uid();
  if v_master.id is null or v_master.role <> 'master' or not coalesce(v_master.active, false) then
    raise exception 'Only an active Master can transfer customers';
  end if;

  select * into v_customer from public.customers where id = p_customer_id for update;
  if v_customer.id is null then raise exception 'Customer not found'; end if;

  update public.customers
  set previous_service_company_id = service_company_id,
      service_company_id = p_service_company_id,
      company_id = p_service_company_id,
      organization_id = p_service_company_id,
      assignment_status = case
        when p_service_company_id is null and first_payment_at is null then 'pending_payment'
        when p_service_company_id is null then 'ready_for_assignment'
        else 'assigned'
      end,
      last_transfer_at = now(),
      last_transfer_reason = nullif(trim(coalesce(p_reason, '')), ''),
      previous_company_notified_at = null
  where id = p_customer_id
  returning * into v_customer;

  return v_customer;
end;
$$;

revoke all on function public.master_transfer_customer(uuid,uuid,text) from public, anon;
grant execute on function public.master_transfer_customer(uuid,uuid,text) to authenticated;

commit;
