-- Customer property and service evidence must never be publicly enumerable.
-- The app resolves short-lived signed URLs after the database authorizes a row.
begin;

alter table public.photos add column if not exists storage_bucket text;
update public.photos set storage_bucket=case
  when is_profile then 'property-photos'
  when public_url like '%/task-photos/%' then 'task-photos'
  when public_url like '%/before-after/%' then 'before-after'
  else 'work-photos' end
where storage_bucket is null;
alter table public.photos alter column storage_bucket set not null;
alter table public.photos drop constraint if exists photos_storage_bucket_valid;
alter table public.photos add constraint photos_storage_bucket_valid
check(storage_bucket in ('property-photos','work-photos','task-photos','before-after'));

update storage.buckets set public=false
where id in ('property-photos','work-photos','task-photos','before-after');

drop policy if exists property_photos_public_read on storage.objects;
drop policy if exists work_photos_public_read on storage.objects;
drop policy if exists task_photos_public_read on storage.objects;
drop policy if exists before_after_public_read on storage.objects;
drop policy if exists authenticated_upload_property_photos on storage.objects;
drop policy if exists authenticated_upload_work_photos on storage.objects;
drop policy if exists authenticated_upload_task_photos on storage.objects;
drop policy if exists authenticated_upload_before_after on storage.objects;

create or replace function public.can_access_company_photo_path(p_path text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.profiles pr
    where pr.id=auth.uid() and pr.active
      and split_part(p_path,'/',1)=coalesce(pr.company_id,pr.organization_id)::text
      and (
        pr.role::text in ('admin','manager')
        or (pr.role::text='customer' and exists(
          select 1 from public.photos ph join public.properties p on p.id=ph.property_id
          join public.customers c on c.id=p.customer_id
          where ph.storage_path=p_path and c.profile_id=pr.id and c.archived_at is null
        ))
        or (pr.role::text='employee' and exists(
          select 1 from public.photos ph join public.employees e on e.profile_id=pr.id and e.active
          where ph.storage_path=p_path and (
            exists(select 1 from public.visits v where v.id=ph.visit_id and (v.assigned_employee_id=e.id or v.crew_id=e.crew_id))
            or exists(select 1 from public.tasks t where t.id=ph.task_id and (t.assigned_employee_id=e.id or t.assigned_crew_id=e.crew_id))
            or (ph.is_profile and exists(select 1 from public.visits v where v.property_id=ph.property_id and (v.assigned_employee_id=e.id or v.crew_id=e.crew_id)))
          )
        ))
      )
  )
$$;
revoke all on function public.can_access_company_photo_path(text) from public,anon;
grant execute on function public.can_access_company_photo_path(text) to authenticated,service_role;

create or replace function public.can_write_company_photo_path(p_path text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles pr where pr.id=auth.uid() and pr.active
    and pr.role::text in ('admin','manager','employee')
    and split_part(p_path,'/',1)=coalesce(pr.company_id,pr.organization_id)::text)
$$;
revoke all on function public.can_write_company_photo_path(text) from public,anon;
grant execute on function public.can_write_company_photo_path(text) to authenticated,service_role;

create policy company_private_photo_read on storage.objects
for select to authenticated
using (
  bucket_id in ('property-photos','work-photos','task-photos','before-after')
  and public.can_access_company_photo_path(name)
);

create policy company_private_photo_insert on storage.objects
for insert to authenticated
with check (
  bucket_id in ('property-photos','work-photos','task-photos','before-after')
  and public.can_write_company_photo_path(name)
);

create policy company_private_photo_update on storage.objects
for update to authenticated
using (
  bucket_id in ('property-photos','work-photos','task-photos','before-after')
  and public.can_write_company_photo_path(name)
)
with check (
  bucket_id in ('property-photos','work-photos','task-photos','before-after')
  and public.can_write_company_photo_path(name)
);

create policy company_private_photo_delete on storage.objects
for delete to authenticated
using (
  bucket_id in ('property-photos','work-photos','task-photos','before-after')
  and public.can_write_company_photo_path(name)
);

create or replace function public.get_property_photo_history(p_property_id uuid)
returns jsonb language sql security definer set search_path=public as $$
  with allowed as (
    select p.id,p.company_id
    from properties p
    where p.id=p_property_id and p.company_id=public.current_company_id()
      and (
        exists(select 1 from profiles pr where pr.id=auth.uid() and pr.active and pr.role::text in ('admin','manager','master'))
        or exists(select 1 from customers c where c.id=p.customer_id and c.profile_id=auth.uid() and c.archived_at is null)
        or exists(
          select 1 from visits av join employees e
            on (e.id=av.assigned_employee_id or e.crew_id=av.crew_id)
          where av.property_id=p.id and e.profile_id=auth.uid() and e.active
        )
      )
  ), profile_photo as (
    select ph.storage_path from allowed a join photos ph on ph.property_id=a.id
    where ph.is_profile order by ph.created_at desc limit 1
  ), visit_rows as (
    select v.id,v.scheduled_date,v.status::text status,v.started_at,v.finished_at,v.duration_seconds,
      v.employee_notes,v.customer_visible_summary,coalesce(j.service_name,'Property Service') service_name,
      coalesce(cr.name,'Crew') crew_name,
      coalesce(jsonb_agg(jsonb_build_object('id',ph.id,'bucket',ph.storage_bucket,'storagePath',ph.storage_path,'type',ph.photo_type,'caption',ph.caption,'sortOrder',ph.sort_order,'createdAt',ph.created_at) order by ph.sort_order,ph.created_at) filter(where ph.id is not null),'[]'::jsonb) photos
    from allowed a join visits v on v.property_id=a.id and v.company_id=a.company_id
    left join jobs j on j.id=v.job_id left join crews cr on cr.id=v.crew_id
    left join photos ph on ph.visit_id=v.id and ph.property_id=a.id and not ph.is_profile
    group by v.id,j.service_name,cr.name
  )
  select jsonb_build_object(
    'profilePhoto',case when exists(select 1 from profile_photo) then jsonb_build_object('bucket','property-photos','storagePath',(select storage_path from profile_photo)) else null end,
    'visits',coalesce((select jsonb_agg(to_jsonb(visit_rows) order by scheduled_date desc,started_at desc nulls last) from visit_rows),'[]'::jsonb)
  );
$$;

revoke all on function public.get_property_photo_history(uuid) from public,anon;
grant execute on function public.get_property_photo_history(uuid) to authenticated,service_role;

-- Public URLs are no longer canonical. Paths remain stable and auditable.
update public.photos set public_url=null
where storage_path is not null and company_id is not null;
update public.properties set official_photo_url=null
where exists(select 1 from public.photos ph where ph.property_id=properties.id and ph.is_profile);

commit;
