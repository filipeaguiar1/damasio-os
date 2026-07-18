-- Shared property history with role-aware row authorization.
begin;

create or replace function public.get_property_photo_history(p_property_id uuid)
returns jsonb language sql security definer set search_path=public as $$
  with allowed as (
    select p.id,p.company_id,p.official_photo_url
    from properties p
    where p.id=p_property_id and p.company_id=public.current_company_id()
      and (
        exists(select 1 from profiles pr where pr.id=auth.uid() and pr.active and pr.role::text in ('admin','manager','master'))
        or exists(select 1 from customers c where c.id=p.customer_id and c.profile_id=auth.uid() and c.archived_at is null)
        or exists(select 1 from visits av join employees e on e.id=av.assigned_employee_id where av.property_id=p.id and e.profile_id=auth.uid() and e.active)
      )
  ), visit_rows as (
    select v.id,v.scheduled_date,v.status::text status,v.started_at,v.finished_at,v.duration_seconds,
      v.employee_notes,v.customer_visible_summary,coalesce(j.service_name,'Property Service') service_name,
      coalesce(cr.name,'Crew') crew_name,
      coalesce(jsonb_agg(jsonb_build_object('id',ph.id,'url',ph.public_url,'type',ph.photo_type,'caption',ph.caption,'sortOrder',ph.sort_order,'createdAt',ph.created_at) order by ph.sort_order,ph.created_at) filter(where ph.id is not null),'[]'::jsonb) photos
    from allowed a join visits v on v.property_id=a.id and v.company_id=a.company_id
    left join jobs j on j.id=v.job_id left join crews cr on cr.id=v.crew_id
    left join photos ph on ph.visit_id=v.id and ph.property_id=a.id and not ph.is_profile
    group by v.id,j.service_name,cr.name
  )
  select jsonb_build_object('profilePhotoUrl',(select official_photo_url from allowed),'visits',coalesce((select jsonb_agg(to_jsonb(visit_rows) order by scheduled_date desc,started_at desc nulls last) from visit_rows),'[]'::jsonb));
$$;

revoke all on function public.get_property_photo_history(uuid) from public,anon;
grant execute on function public.get_property_photo_history(uuid) to authenticated,service_role;

commit;
