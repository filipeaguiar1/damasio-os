create or replace function public.can_access_company_photo_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.active
      and coalesce(pr.company_id, pr.organization_id) is not null
      and split_part(p_path,'/',1) = coalesce(pr.company_id,pr.organization_id)::text
      and (
        pr.role::text in ('admin','manager')
        or (
          pr.role::text = 'customer'
          and exists (
            select 1
            from public.photos ph
            join public.properties p on p.id = ph.property_id
            join public.customers c on c.id = p.customer_id
            where ph.storage_path = p_path
              and c.profile_id = pr.id
              and c.archived_at is null
              and coalesce(c.company_id,c.organization_id) = coalesce(pr.company_id,pr.organization_id)
              and coalesce(p.company_id,p.organization_id) = coalesce(pr.company_id,pr.organization_id)
              and coalesce(ph.company_id,ph.organization_id) = coalesce(pr.company_id,pr.organization_id)
          )
        )
        or (
          pr.role::text = 'employee'
          and exists (
            select 1
            from public.photos ph
            join public.employees e on e.profile_id = pr.id
              and e.active
              and coalesce(e.company_id,e.organization_id) = coalesce(pr.company_id,pr.organization_id)
            where ph.storage_path = p_path
              and coalesce(ph.company_id,ph.organization_id) = coalesce(pr.company_id,pr.organization_id)
              and (
                exists (
                  select 1 from public.visits v
                  where v.id = ph.visit_id
                    and coalesce(v.company_id,v.organization_id) = coalesce(pr.company_id,pr.organization_id)
                    and (v.assigned_employee_id = e.id or v.crew_id = e.crew_id)
                )
                or exists (
                  select 1 from public.tasks t
                  where t.id = ph.task_id
                    and coalesce(t.company_id,t.organization_id) = coalesce(pr.company_id,pr.organization_id)
                    and (t.assigned_employee_id = e.id or t.assigned_crew_id = e.crew_id)
                )
                or (
                  ph.is_profile
                  and exists (
                    select 1 from public.visits v
                    where v.property_id = ph.property_id
                      and coalesce(v.company_id,v.organization_id) = coalesce(pr.company_id,pr.organization_id)
                      and (v.assigned_employee_id = e.id or v.crew_id = e.crew_id)
                  )
                )
              )
          )
        )
      )
  )
$$;

create or replace function public.can_write_company_photo_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.active
      and coalesce(pr.company_id,pr.organization_id) is not null
      and split_part(p_path,'/',1) = coalesce(pr.company_id,pr.organization_id)::text
      and (
        pr.role::text in ('admin','manager')
        or (
          pr.role::text = 'employee'
          and exists (
            select 1
            from public.tasks t
            join public.employees e on e.profile_id = pr.id
              and e.active
              and coalesce(e.company_id,e.organization_id) = coalesce(pr.company_id,pr.organization_id)
            where t.id::text = split_part(p_path,'/',3)
              and t.property_id::text = split_part(p_path,'/',2)
              and coalesce(t.company_id,t.organization_id) = coalesce(pr.company_id,pr.organization_id)
              and (t.assigned_employee_id = e.id or t.assigned_crew_id = e.crew_id)
          )
        )
        or (
          pr.role::text = 'customer'
          and exists (
            select 1
            from public.tasks t
            join public.customers c on c.id = t.customer_id
            where t.id::text = split_part(p_path,'/',3)
              and t.property_id::text = split_part(p_path,'/',2)
              and c.profile_id = pr.id
              and c.archived_at is null
              and coalesce(c.company_id,c.organization_id) = coalesce(pr.company_id,pr.organization_id)
              and coalesce(t.company_id,t.organization_id) = coalesce(pr.company_id,pr.organization_id)
          )
        )
      )
  )
$$;
