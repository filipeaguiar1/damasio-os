-- Align direct-table event reads with the Manager module permission map.

begin;

alter policy task_events_company_read on public.task_events
using (
  company_id = public.current_company_id()
  and (
    exists (
      select 1 from public.profiles p
      where p.id=auth.uid()
        and p.active
        and (
          p.role::text='admin'
          or (p.role::text='manager' and public.company_module_permission_allowed('tasks','view'))
        )
    )
    or exists (
      select 1 from public.tasks t
      join public.customers c on c.id=t.customer_id
      where t.id=task_events.task_id
        and c.profile_id=auth.uid()
        and c.archived_at is null
    )
    or exists (
      select 1 from public.tasks t
      join public.employees e on e.profile_id=auth.uid() and e.active
      where t.id=task_events.task_id
        and (t.assigned_employee_id=e.id or t.assigned_crew_id=e.crew_id)
    )
  )
);

alter policy visit_reopen_events_company_admin_read on public.visit_reopen_events
using (
  exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and p.active=true
      and coalesce(p.company_id,p.organization_id)=visit_reopen_events.company_id
      and (
        p.role::text='admin'
        or (
          p.role::text='manager'
          and (
            public.company_module_permission_allowed('routes','view')
            or public.company_module_permission_allowed('dispatch','view')
          )
        )
      )
  )
);

commit;
