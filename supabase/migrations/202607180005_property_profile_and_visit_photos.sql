-- One intentional profile image per property; service photos belong to one visit.
begin;

alter table public.photos add column if not exists caption text;
alter table public.photos add column if not exists sort_order integer not null default 0;
alter table public.photos add column if not exists is_profile boolean not null default false;

update public.photos set is_profile=true
where photo_type='property' and visit_id is null and task_id is null
  and id in (select distinct on (property_id) id from public.photos where property_id is not null and photo_type='property' order by property_id,created_at desc);

create unique index if not exists photos_one_profile_per_property
on public.photos(property_id) where is_profile;

alter table public.photos drop constraint if exists photos_scope_valid;
alter table public.photos add constraint photos_scope_valid check (
  (is_profile and photo_type='property' and property_id is not null and visit_id is null and task_id is null)
  or
  (not is_profile and property_id is not null and (visit_id is not null or task_id is not null) and photo_type in ('before','after','issue','completion'))
) not valid;

create index if not exists photos_visit_gallery on public.photos(visit_id,sort_order,created_at) where visit_id is not null;
create index if not exists photos_property_history on public.photos(property_id,created_at desc);

create or replace function public.get_property_photo_history(p_property_id uuid)
returns jsonb language sql security definer set search_path=public as $$
  with allowed as (
    select p.id,p.company_id,p.official_photo_url
    from properties p
    where p.id=p_property_id and p.company_id=public.current_company_id()
  ), visit_rows as (
    select v.id,v.scheduled_date,v.status::text status,v.started_at,v.finished_at,v.duration_seconds,
      v.employee_notes,v.customer_visible_summary,coalesce(j.service_name,'Property Service') service_name,
      coalesce(jsonb_agg(jsonb_build_object('id',ph.id,'url',ph.public_url,'type',ph.photo_type,'caption',ph.caption,'sortOrder',ph.sort_order,'createdAt',ph.created_at) order by ph.sort_order,ph.created_at) filter(where ph.id is not null),'[]'::jsonb) photos
    from allowed a join visits v on v.property_id=a.id and v.company_id=a.company_id
    left join jobs j on j.id=v.job_id left join photos ph on ph.visit_id=v.id and ph.property_id=a.id and not ph.is_profile
    group by v.id,j.service_name
  )
  select jsonb_build_object(
    'profilePhotoUrl',(select official_photo_url from allowed),
    'visits',coalesce((select jsonb_agg(to_jsonb(visit_rows) order by scheduled_date desc,started_at desc nulls last) from visit_rows),'[]'::jsonb)
  );
$$;

revoke all on function public.get_property_photo_history(uuid) from public,anon;
grant execute on function public.get_property_photo_history(uuid) to authenticated,service_role;

drop function if exists public.get_customer_property_directory();
create function public.get_customer_property_directory()
returns table(customer_id uuid,property_id uuid,full_name text,email text,phone text,customer_notes text,address_line1 text,city text,province text,postal_code text,lot_size text,grass_height text,gate boolean,dog boolean,irrigation boolean,access_notes text,property_notes text,official_photo_url text,created_at timestamptz)
language sql security definer set search_path=public as $$
  select c.id,p.id,c.full_name,c.email,c.phone,c.notes,p.address_line1,p.city,p.province,p.postal_code,p.lot_size::text,p.grass_height::text,p.gate,p.dog,p.irrigation,p.access_notes,p.property_notes,p.official_photo_url,p.created_at
  from customers c join properties p on p.customer_id=c.id and p.company_id=c.company_id
  where c.company_id=public.current_company_id() and c.archived_at is null order by p.created_at desc;
$$;
grant execute on function public.get_customer_property_directory() to authenticated;

commit;
