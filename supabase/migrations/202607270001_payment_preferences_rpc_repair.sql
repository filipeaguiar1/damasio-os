begin;

alter table public.customers
  add column if not exists service_payment_method text not null default 'card',
  add column if not exists tip_payment_method text not null default 'card';

create or replace function public.get_customer_payment_preferences()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
begin
  select c.* into v_customer
  from public.customers c
  where c.profile_id = auth.uid()
  order by c.created_at desc
  limit 1;

  if v_customer.id is null then
    raise exception 'Customer account not found';
  end if;

  return jsonb_build_object(
    'servicePaymentMethod', coalesce(v_customer.service_payment_method, 'card'),
    'tipPaymentMethod', coalesce(v_customer.tip_payment_method, 'card')
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

  select c.id into v_customer_id
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

notify pgrst, 'reload schema';
commit;
