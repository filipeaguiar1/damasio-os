-- Damasio OS V52 - tenant-safe workflow events and canonical status contracts.
begin;

alter table public.workflow_events
  add column if not exists company_id uuid references public.organizations(id) on delete cascade;

update public.workflow_events event
set company_id = event.org_id
where event.company_id is null
  and exists (select 1 from public.organizations organization where organization.id = event.org_id);

create index if not exists idx_workflow_events_company_created
  on public.workflow_events(company_id, created_at desc);

drop policy if exists workflow_events_demo_all on public.workflow_events;
drop policy if exists v52_workflow_events_company_select on public.workflow_events;
drop policy if exists v52_workflow_events_company_insert on public.workflow_events;

create policy v52_workflow_events_company_select
  on public.workflow_events
  for select to authenticated
  using (
    company_id = public.current_company_id()
    or public.master_has_company_access(company_id, 'read_only')
  );

create policy v52_workflow_events_company_insert
  on public.workflow_events
  for insert to authenticated
  with check (
    company_id = public.current_company_id()
    or public.master_has_company_access(company_id, 'operational_support')
  );

create or replace function public.record_workflow_event(
  p_entity_type text,
  p_entity_id uuid,
  p_from_stage text,
  p_to_stage text,
  p_actor text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
begin
  if v_company is null then raise exception 'Active company session required'; end if;
  insert into public.workflow_events(
    org_id, company_id, entity_type, entity_id, from_stage, to_stage, actor, note
  ) values (
    v_company, v_company, p_entity_type, p_entity_id, p_from_stage, p_to_stage,
    coalesce(nullif(trim(p_actor), ''), 'System'), nullif(trim(coalesce(p_note, '')), '')
  );
end;
$$;

revoke all on function public.record_workflow_event(text,uuid,text,text,text,text) from public;
grant execute on function public.record_workflow_event(text,uuid,text,text,text,text) to authenticated;

commit;
