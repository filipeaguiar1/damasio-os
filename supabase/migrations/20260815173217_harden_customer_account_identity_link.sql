create or replace function public.link_current_customer_account()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt()->>'email', '')));
  v_profile_role text;
  v_profile_active boolean;
  v_profile_company uuid;
  v_customer_id uuid;
  v_customer_company uuid;
  v_candidate_ids uuid[];
begin
  if v_user_id is null or v_email = '' then
    raise exception 'Authenticated Customer email required';
  end if;

  select p.role::text, p.active, coalesce(p.company_id, p.organization_id)
    into v_profile_role, v_profile_active, v_profile_company
  from public.profiles p
  where p.id = v_user_id
  limit 1;

  if not found or not coalesce(v_profile_active, false) or v_profile_role <> 'customer' then
    raise exception 'Only an active Customer profile can link a Customer account';
  end if;

  select c.id, coalesce(c.company_id, c.organization_id)
    into v_customer_id, v_customer_company
  from public.customers c
  where c.profile_id = v_user_id
    and c.archived_at is null
  order by c.created_at desc
  limit 1;

  if v_customer_id is not null then
    if v_profile_company is not null
       and v_customer_company is not null
       and v_profile_company <> v_customer_company then
      raise exception 'Customer company identity does not match the signed-in profile';
    end if;

    if v_profile_company is null and v_customer_company is not null then
      update public.profiles
      set company_id = coalesce(company_id, v_customer_company),
          organization_id = coalesce(organization_id, v_customer_company),
          email = coalesce(email, v_email)
      where id = v_user_id
        and role::text = 'customer';
    end if;

    return v_customer_id;
  end if;

  select array_agg(candidate.id order by candidate.created_at desc)
    into v_candidate_ids
  from (
    select c.id, c.created_at
    from public.customers c
    where lower(trim(coalesce(c.email, ''))) = v_email
      and c.archived_at is null
      and c.profile_id is null
      and (
        v_profile_company is null
        or coalesce(c.company_id, c.organization_id) = v_profile_company
      )
    order by c.created_at desc
    limit 2
  ) candidate;

  if coalesce(cardinality(v_candidate_ids), 0) = 0 then
    return null;
  end if;

  if cardinality(v_candidate_ids) > 1 then
    raise exception 'Multiple Customer records match this account; contact support to choose the correct company';
  end if;

  v_customer_id := v_candidate_ids[1];

  select coalesce(c.company_id, c.organization_id)
    into v_customer_company
  from public.customers c
  where c.id = v_customer_id
    and c.archived_at is null
    and c.profile_id is null
  for update;

  if not found then
    raise exception 'Customer account changed while linking; try again';
  end if;

  if v_profile_company is not null
     and v_customer_company is not null
     and v_profile_company <> v_customer_company then
    raise exception 'Customer company identity does not match the signed-in profile';
  end if;

  update public.customers
  set profile_id = v_user_id
  where id = v_customer_id
    and profile_id is null;

  if not found then
    raise exception 'Customer account is already linked to another profile';
  end if;

  update public.profiles
  set company_id = coalesce(company_id, v_customer_company),
      organization_id = coalesce(organization_id, v_customer_company),
      email = coalesce(email, v_email)
  where id = v_user_id
    and role::text = 'customer'
    and active;

  if v_customer_company is not null then
    update public.quote_invitations
    set status = 'claimed',
        claimed_by = v_user_id,
        claimed_at = coalesce(claimed_at, now())
    where lower(trim(email)) = v_email
      and company_id = v_customer_company
      and status in ('pending', 'sent');
  end if;

  return v_customer_id;
end;
$function$;

revoke all on function public.link_current_customer_account() from public, anon;
grant execute on function public.link_current_customer_account() to authenticated;
