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
  from public.profiles p
  join public.customers c on c.profile_id = p.id
  where p.id = auth.uid()
    and p.active = true
    and p.role::text = 'customer'
    and c.archived_at is null
    and (
      coalesce(p.company_id,p.organization_id) is null
      or coalesce(c.company_id,c.organization_id) is null
      or coalesce(p.company_id,p.organization_id)=coalesce(c.company_id,c.organization_id)
    )
  order by c.created_at desc
  limit 1;

  if v_customer.id is null then
    raise exception 'Active Customer account not found';
  end if;

  return jsonb_build_object(
    'servicePaymentMethod',coalesce(v_customer.service_payment_method,'card'),
    'tipPaymentMethod',coalesce(v_customer.tip_payment_method,'card')
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
  from public.profiles p
  join public.customers c on c.profile_id = p.id
  where p.id = auth.uid()
    and p.active = true
    and p.role::text = 'customer'
    and c.archived_at is null
    and (
      coalesce(p.company_id,p.organization_id) is null
      or coalesce(c.company_id,c.organization_id) is null
      or coalesce(p.company_id,p.organization_id)=coalesce(c.company_id,c.organization_id)
    )
  order by c.created_at desc
  limit 1;

  if v_customer_id is null then
    raise exception 'Active Customer account not found';
  end if;

  update public.customers
  set service_payment_method=p_service_payment_method,
      tip_payment_method=p_tip_payment_method,
      updated_at=now()
  where id=v_customer_id
    and archived_at is null;

  return jsonb_build_object(
    'servicePaymentMethod',p_service_payment_method,
    'tipPaymentMethod',p_tip_payment_method
  );
end;
$$;

revoke all on function public.get_customer_payment_preferences() from public, anon;
grant execute on function public.get_customer_payment_preferences() to authenticated, service_role;
revoke all on function public.save_customer_payment_preferences(text,text) from public, anon;
grant execute on function public.save_customer_payment_preferences(text,text) to authenticated, service_role;
