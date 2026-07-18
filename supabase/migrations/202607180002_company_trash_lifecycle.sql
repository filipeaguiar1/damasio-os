-- Reversible company deletion with a 60-day retention window.
-- Lifecycle events are the canonical outbox for synchronizing database data,
-- Supabase Storage files, Auth accounts and connected tools.

begin;

alter table public.organizations add column if not exists deleted_at timestamptz;
alter table public.organizations add column if not exists purge_after timestamptz;
alter table public.organizations add column if not exists deleted_by_profile_id uuid references public.profiles(id) on delete set null;
alter table public.organizations add column if not exists deletion_reason text;

create index if not exists idx_organizations_trash_retention
on public.organizations(purge_after)
where deleted_at is not null;

create table if not exists public.master_company_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  event_type text not null check (event_type in ('company.trashed','company.restored','company.purge_due')),
  sync_status text not null default 'pending' check (sync_status in ('pending','processing','completed','failed')),
  sync_scopes text[] not null default array['database','files','accounts','tools']::text[],
  snapshot jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_master_company_lifecycle_pending
on public.master_company_lifecycle_events(sync_status,created_at);

alter table public.master_company_lifecycle_events enable row level security;
drop policy if exists master_company_lifecycle_master_only on public.master_company_lifecycle_events;
create policy master_company_lifecycle_master_only
on public.master_company_lifecycle_events for select to authenticated
using (public.is_master());

grant select on table public.master_company_lifecycle_events to authenticated;
grant all privileges on table public.master_company_lifecycle_events to service_role;

create or replace function public.master_trash_company(
  p_company_id uuid,
  p_master_profile_id uuid,
  p_reason text default null
) returns public.organizations
language plpgsql
security definer
set search_path=public
as $$
declare
  v_company public.organizations;
  v_snapshot jsonb;
begin
  if not exists(select 1 from profiles where id=p_master_profile_id and role::text='master' and active) then
    raise exception 'Only an active Master can move a company to trash';
  end if;

  select * into v_company from organizations where id=p_company_id for update;
  if not found then raise exception 'Company not found'; end if;
  if v_company.deleted_at is not null then return v_company; end if;

  select jsonb_build_object(
    'company_was_active',v_company.active,
    'active_profile_ids',coalesce((select jsonb_agg(id) from profiles where coalesce(company_id,organization_id)=p_company_id and active),'[]'::jsonb),
    'active_employee_ids',coalesce((select jsonb_agg(id) from employees where coalesce(company_id,organization_id)=p_company_id and active),'[]'::jsonb)
  ) into v_snapshot;

  update organizations set
    active=false,
    deleted_at=now(),
    purge_after=now()+interval '60 days',
    deleted_by_profile_id=p_master_profile_id,
    deletion_reason=nullif(trim(coalesce(p_reason,'')),''),
    updated_at=now()
  where id=p_company_id returning * into v_company;

  update profiles set active=false where coalesce(company_id,organization_id)=p_company_id and active;
  update employees set active=false where coalesce(company_id,organization_id)=p_company_id and active;
  update master_company_access_requests set revoked_at=coalesce(revoked_at,now()) where company_id=p_company_id and revoked_at is null;

  insert into master_company_lifecycle_events(company_id,event_type,snapshot)
  values(p_company_id,'company.trashed',v_snapshot);
  insert into master_audit_log(master_profile_id,company_id,action,entity_type,entity_id,details)
  values(p_master_profile_id,p_company_id,'company.trashed','organization',p_company_id,jsonb_build_object('purge_after',v_company.purge_after,'reason',p_reason));
  return v_company;
end
$$;

create or replace function public.master_restore_company(
  p_company_id uuid,
  p_master_profile_id uuid
) returns public.organizations
language plpgsql
security definer
set search_path=public
as $$
declare
  v_company public.organizations;
  v_snapshot jsonb;
begin
  if not exists(select 1 from profiles where id=p_master_profile_id and role::text='master' and active) then
    raise exception 'Only an active Master can restore a company';
  end if;

  select * into v_company from organizations where id=p_company_id for update;
  if not found then raise exception 'Company not found'; end if;
  if v_company.deleted_at is null then return v_company; end if;
  if v_company.purge_after<=now() then raise exception 'The 60-day restoration period has expired'; end if;

  select snapshot into v_snapshot from master_company_lifecycle_events
  where company_id=p_company_id and event_type='company.trashed'
  order by created_at desc limit 1;

  update organizations set active=coalesce((v_snapshot->>'company_was_active')::boolean,true),deleted_at=null,purge_after=null,
    deleted_by_profile_id=null,deletion_reason=null,updated_at=now()
  where id=p_company_id returning * into v_company;

  update profiles set active=true where id in (select value::uuid from jsonb_array_elements_text(coalesce(v_snapshot->'active_profile_ids','[]'::jsonb)));
  update employees set active=true where id in (select value::uuid from jsonb_array_elements_text(coalesce(v_snapshot->'active_employee_ids','[]'::jsonb)));

  insert into master_company_lifecycle_events(company_id,event_type,snapshot)
  values(p_company_id,'company.restored',jsonb_build_object('restored_from',v_snapshot));
  insert into master_audit_log(master_profile_id,company_id,action,entity_type,entity_id)
  values(p_master_profile_id,p_company_id,'company.restored','organization',p_company_id);
  return v_company;
end
$$;

-- Call from a scheduled Supabase job. The synchronization worker must remove
-- files/Auth/tool data and mark this event completed before hard deletion.
create or replace function public.master_queue_expired_company_purges()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_count integer;
begin
  insert into master_company_lifecycle_events(company_id,event_type,snapshot)
  select o.id,'company.purge_due',jsonb_build_object('purge_after',o.purge_after)
  from organizations o
  where o.deleted_at is not null and o.purge_after<=now()
    and not exists (
      select 1 from master_company_lifecycle_events e
      where e.company_id=o.id and e.event_type='company.purge_due'
        and e.sync_status in ('pending','processing','completed')
    );
  get diagnostics v_count=row_count;
  return v_count;
end
$$;

revoke all on function public.master_trash_company(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.master_restore_company(uuid,uuid) from public,anon,authenticated;
revoke all on function public.master_queue_expired_company_purges() from public,anon,authenticated;
grant execute on function public.master_trash_company(uuid,uuid,text) to service_role;
grant execute on function public.master_restore_company(uuid,uuid) to service_role;
grant execute on function public.master_queue_expired_company_purges() to service_role;

commit;
