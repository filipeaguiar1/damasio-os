begin;

create or replace function public.apply_official_billing_split()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.contract_owner_role = 'company' then
    new.platform_fee_basis_points := coalesce(new.platform_fee_basis_points, 1500);
    new.provider_payout_cents := greatest(
      0,
      new.customer_amount_cents - round(new.customer_amount_cents * new.platform_fee_basis_points / 10000.0)::bigint
    );
  elsif new.contract_owner_role = 'master' then
    new.platform_fee_basis_points := null;
    if new.provider_payout_cents is null then
      raise exception 'Master contracts require an exact company payout';
    end if;
    if new.provider_payout_cents > new.customer_amount_cents then
      raise exception 'Company payout cannot exceed customer amount';
    end if;
  end if;

  new.stripe_sync_status := 'pending';
  new.stripe_sync_error := null;
  return new;
end;
$$;

drop trigger if exists billing_agreements_official_split on public.billing_agreements;
create trigger billing_agreements_official_split
before insert or update of customer_amount_cents, provider_payout_cents, platform_fee_basis_points, contract_owner_role, billing_model, collection_timing, prepaid_plan_type
on public.billing_agreements
for each row
execute function public.apply_official_billing_split();

update public.billing_agreements
set platform_fee_basis_points = coalesce(platform_fee_basis_points, 1500)
where contract_owner_role = 'company'
  and active = true;

commit;
