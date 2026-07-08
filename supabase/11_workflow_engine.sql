-- Damasio OS V42.7 - Operations Intelligence / Workflow Engine
-- Run after supabase/10_performance_indexes.sql.

create table if not exists public.workflow_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default '00000000-0000-0000-0000-000000000001',
  entity_type text not null check (entity_type in ('lead','quote','job','visit','task','property')),
  entity_id uuid,
  from_stage text check (from_stage is null or from_stage in ('lead','quote','approved','scheduled','assigned','in_progress','completed','feedback','task','archived')),
  to_stage text not null check (to_stage in ('lead','quote','approved','scheduled','assigned','in_progress','completed','feedback','task','archived')),
  actor text not null default 'System',
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_workflow_events_org_created on public.workflow_events (org_id, created_at desc);
create index if not exists idx_workflow_events_entity on public.workflow_events (entity_type, entity_id, created_at desc);
create index if not exists idx_workflow_events_stage on public.workflow_events (org_id, to_stage, created_at desc);

alter table public.workflow_events enable row level security;

drop policy if exists "workflow_events_demo_all" on public.workflow_events;
create policy "workflow_events_demo_all"
  on public.workflow_events
  for all
  using (true)
  with check (true);

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
as $$
begin
  insert into public.workflow_events(entity_type, entity_id, from_stage, to_stage, actor, note)
  values (p_entity_type, p_entity_id, p_from_stage, p_to_stage, coalesce(p_actor, 'System'), p_note);
end;
$$;
