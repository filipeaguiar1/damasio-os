begin;

create or replace function public.get_company_customer_ownership()
returns table (
  customer_id uuid,
  acquisition_source text,
  locked_by_platform boolean
)
language sql
security definer
set search_path = public
as $$
  with current_company as (
    select coalesce(company_id, organization_id) as company_id
    from public.profiles
    where id = auth.uid()
      and active = true
      and role::text in ('admin','manager')
    limit 1
  )
  select
    c.id,
    coalesce(c.acquisition_source, 'platform')::text,
    coalesce(c.acquisition_source, 'platform') = 'platform'
  from public.customers c
  join current_company cc
    on coalesce(c.service_company_id, c.company_id, c.organization_id) = cc.company_id
  where c.archived_at is null;
$$;

revoke all on function public.get_company_customer_ownership() from public, anon;
grant execute on function public.get_company_customer_ownership() to authenticated;

commit;
