create or replace function public.my_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.profiles p
  join public.customers c on c.profile_id = p.id
  where p.id = auth.uid()
    and p.active = true
    and p.role::text = 'customer'
    and c.archived_at is null
    and (
      coalesce(p.company_id, p.organization_id) is null
      or coalesce(c.company_id, c.organization_id) is null
      or coalesce(p.company_id, p.organization_id) = coalesce(c.company_id, c.organization_id)
    )
    and not exists (
      select 1
      from public.temporary_test_accounts t
      where t.auth_user_id = p.id
        and t.disabled_at is null
        and t.expires_at is not null
        and t.expires_at <= now()
    )
  order by c.created_at desc
  limit 1
$$;

revoke all on function public.my_customer_id() from public;
grant execute on function public.my_customer_id() to authenticated, service_role;
