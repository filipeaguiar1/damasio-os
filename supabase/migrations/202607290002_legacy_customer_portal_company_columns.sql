-- Legacy compatibility for Customer portal write tables.
-- Older projects can have organization_id only while shared tenant triggers
-- already expect NEW.company_id to exist.

begin;

alter table public.feedback
  add column if not exists company_id uuid;

alter table public.service_requests
  add column if not exists company_id uuid;

alter table public.tasks
  add column if not exists company_id uuid;

update public.feedback
set company_id = organization_id
where company_id is null
  and organization_id is not null;

update public.service_requests
set company_id = organization_id
where company_id is null
  and organization_id is not null;

update public.tasks
set company_id = organization_id
where company_id is null
  and organization_id is not null;

create index if not exists feedback_company_id_idx
  on public.feedback(company_id);

create index if not exists service_requests_company_id_idx
  on public.service_requests(company_id);

create index if not exists tasks_company_id_idx
  on public.tasks(company_id);

commit;
