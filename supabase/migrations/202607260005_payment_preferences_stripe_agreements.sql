begin;

alter table public.customers
  add column if not exists service_payment_method text not null default 'card',
  add column if not exists tip_payment_method text not null default 'card';

alter table public.billing_agreements
  add column if not exists stripe_product_id text,
  add column if not exists stripe_price_id text,
  add column if not exists stripe_sync_status text not null default 'pending',
  add column if not exists stripe_sync_error text,
  add column if not exists stripe_synced_at timestamptz;

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.customers'::regclass
      and pg_get_constraintdef(oid) ilike '%service_payment_method%'
  loop
    execute format('alter table public.customers drop constraint %I', v_constraint.conname);
  end loop;

  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.customers'::regclass
      and pg_get_constraintdef(oid) ilike '%tip_payment_method%'
  loop
    execute format('alter table public.customers drop constraint %I', v_constraint.conname);
  end loop;

  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.billing_agreements'::regclass
      and pg_get_constraintdef(oid) ilike '%prepaid_plan_type%'
  loop
    execute format('alter table public.billing_agreements drop constraint %I', v_constraint.conname);
  end loop;

  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.billing_agreements'::regclass
      and pg_get_constraintdef(oid) ilike '%stripe_sync_status%'
  loop
    execute format('alter table public.billing_agreements drop constraint %I', v_constraint.conname);
  end loop;
end $$;

alter table public.customers
  add constraint customers_service_payment_method_check
    check (service_payment_method in ('card','account_balance')),
  add constraint customers_tip_payment_method_check
    check (tip_payment_method in ('card','account_balance'));

alter table public.billing_agreements
  add constraint billing_agreements_prepaid_plan_type_check
    check (prepaid_plan_type is null or prepaid_plan_type in ('monthly','seasonal','annual')),
  add constraint billing_agreements_stripe_sync_status_check
    check (stripe_sync_status in ('pending','synced','error'));

create or replace function public.get_customer_payment_preferences()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
begin
  select c.*
  into v_customer
  from public.customers c
  where c.profile_id = auth.uid()
  order by c.created_at desc
  limit 1;

  if v_customer.id is null then
    raise exception 'Customer account not found';
  end if;

  return jsonb_build_object(
    'servicePaymentMethod', v_customer.service_payment_method,
    'tipPaymentMethod', v_customer.tip_payment_method
  );
end;
$$;

create or replace function public.save_customer_payment_preferences(
  p_service_payment_method text,
  p_tip_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  if p_service_payment_method not in ('card','account_balance')
     or p_tip_payment_method not in ('card','account_balance') then
    raise exception 'Invalid payment method';
  end if;

  select c.id
  into v_customer_id
  from public.customers c
  where c.profile_id = auth.uid()
  order by c.created_at desc
  limit 1;

  if v_customer_id is null then
    raise exception 'Customer account not found';
  end if;

  update public.customers
  set service_payment_method = p_service_payment_method,
      tip_payment_method = p_tip_payment_method,
      updated_at = now()
  where id = v_customer_id;

  return jsonb_build_object(
    'servicePaymentMethod', p_service_payment_method,
    'tipPaymentMethod', p_tip_payment_method
  );
end;
$$;

revoke all on function public.get_customer_payment_preferences() from public, anon;
revoke all on function public.save_customer_payment_preferences(text,text) from public, anon;
grant execute on function public.get_customer_payment_preferences() to authenticated;
grant execute on function public.save_customer_payment_preferences(text,text) to authenticated;

commit;
