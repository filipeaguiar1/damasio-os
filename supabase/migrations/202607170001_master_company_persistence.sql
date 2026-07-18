-- Keep Master company reads persistent across refreshes and new sessions.
-- The application uses a protected server endpoint, while this policy also
-- makes authenticated Master reads safe for database tools and diagnostics.

begin;

create or replace function public.is_master()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.profiles
    where id=auth.uid()
      and role::text='master'
      and active
  )
$$;

revoke all on function public.is_master() from public;
grant execute on function public.is_master() to authenticated;

alter table public.organizations enable row level security;

drop policy if exists master_can_read_all_organizations on public.organizations;
create policy master_can_read_all_organizations
on public.organizations
for select
to authenticated
using (public.is_master());

commit;
