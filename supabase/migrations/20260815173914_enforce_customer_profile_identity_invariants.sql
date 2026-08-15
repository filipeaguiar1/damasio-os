create or replace function public.guard_customer_profile_role_repurpose()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.role::text is distinct from new.role::text
     and new.role::text = 'customer'
     and old.role::text in ('master','admin','manager','employee') then
    raise exception 'Existing staff profiles cannot be repurposed as Customer accounts; use a separate Customer email/account';
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_customer_profile_role_repurpose_trigger on public.profiles;
create trigger guard_customer_profile_role_repurpose_trigger
before update of role on public.profiles
for each row
execute function public.guard_customer_profile_role_repurpose();

create or replace function public.guard_customer_profile_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile_role text;
  v_profile_active boolean;
  v_profile_email text;
  v_profile_company uuid;
  v_customer_company uuid;
begin
  if new.profile_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.profile_id is not distinct from old.profile_id then
    return new;
  end if;

  select p.role::text, p.active, lower(trim(coalesce(p.email, ''))), coalesce(p.company_id, p.organization_id)
    into v_profile_role, v_profile_active, v_profile_email, v_profile_company
  from public.profiles p
  where p.id = new.profile_id
  limit 1;

  if not found or not coalesce(v_profile_active, false) or v_profile_role <> 'customer' then
    raise exception 'Customer profile_id must reference an active Customer profile';
  end if;

  if coalesce(trim(new.email), '') <> ''
     and v_profile_email <> ''
     and lower(trim(new.email)) <> v_profile_email then
    raise exception 'Customer email must match the linked Customer profile email';
  end if;

  v_customer_company := coalesce(new.company_id, new.organization_id);
  if v_customer_company is not null
     and v_profile_company is not null
     and v_customer_company <> v_profile_company then
    raise exception 'Customer company must match the linked Customer profile company';
  end if;

  return new;
end;
$function$;

drop trigger if exists guard_customer_profile_link_trigger on public.customers;
create trigger guard_customer_profile_link_trigger
before insert or update of profile_id on public.customers
for each row
execute function public.guard_customer_profile_link();
