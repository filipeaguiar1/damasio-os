-- Damasio OS V51.1 — Multi Company Complete
-- Security, migration, company isolation, audit, health check and dashboard foundation.
begin;

create extension if not exists pgcrypto;

-- Canonical tenant helpers.
create or replace function public.is_master()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='master' and active)
$$;

create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path=public as $$
  select coalesce(company_id,organization_id) from public.profiles where id=auth.uid() and active limit 1
$$;

create or replace function public.master_has_company_access(p_company_id uuid, p_required_level text default 'read_only')
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_master() and exists(
    select 1 from public.master_company_access_requests r
    where r.master_profile_id=auth.uid()
      and r.company_id=p_company_id
      and r.approved_at is not null
      and r.revoked_at is null
      and coalesce(r.session_expires_at,r.code_expires_at)>now()
      and case p_required_level
        when 'read_only' then r.access_level in ('read_only','operational_support','full_temporary')
        when 'operational_support' then r.access_level in ('operational_support','full_temporary')
        when 'full_temporary' then r.access_level='full_temporary'
        else false end
  )
$$;

-- Backfill company_id across the ERP and keep legacy organization_id synchronized.
do $$
declare t text;
begin
  foreach t in array array['customers','crews','employees','properties','service_requests','quotes','invoices','payments','jobs','routes','visits','tasks','photos','feedback','activity_log'] loop
    execute format('alter table public.%I add column if not exists company_id uuid references public.organizations(id) on delete cascade',t);
    execute format('update public.%I set company_id=organization_id where company_id is null and organization_id is not null',t);
    execute format('update public.%I set organization_id=company_id where organization_id is null and company_id is not null',t);
    execute format('create index if not exists %I on public.%I(company_id)', 'idx_'||t||'_company_id_v511', t);
  end loop;
end $$;

-- Keep both identifiers aligned during the transition.
create or replace function public.sync_company_identifier()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.company_id is null then new.company_id:=new.organization_id; end if;
  if new.organization_id is null then new.organization_id:=new.company_id; end if;
  if new.company_id is distinct from new.organization_id then
    raise exception 'company_id and organization_id must reference the same company';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['customers','crews','employees','properties','service_requests','quotes','invoices','payments','jobs','routes','visits','tasks','photos','feedback','activity_log'] loop
    execute format('drop trigger if exists %I on public.%I','trg_'||t||'_sync_company',t);
    execute format('create trigger %I before insert or update of company_id,organization_id on public.%I for each row execute function public.sync_company_identifier()','trg_'||t||'_sync_company',t);
  end loop;
end $$;

-- Company-scoped RLS. Existing role-specific policies remain; these policies enforce tenant boundaries.
do $$
declare t text; pol text;
begin
  foreach t in array array['customers','crews','employees','properties','service_requests','quotes','invoices','payments','jobs','routes','visits','tasks','photos','feedback','activity_log'] loop
    pol:='v511_company_isolation_'||t;
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',pol,t);
    execute format($f$create policy %I on public.%I as restrictive for all to authenticated
      using (company_id=public.current_company_id() or public.master_has_company_access(company_id,'read_only'))
      with check (company_id=public.current_company_id() or public.master_has_company_access(company_id,'operational_support'))$f$,pol,t);
  end loop;
end $$;

-- Profiles and organizations are tenant-protected too.
drop policy if exists v511_profiles_company_isolation on public.profiles;
create policy v511_profiles_company_isolation on public.profiles as restrictive for select to authenticated
using (id=auth.uid() or coalesce(company_id,organization_id)=public.current_company_id() or public.is_master());

drop policy if exists v511_organizations_visibility on public.organizations;
create policy v511_organizations_visibility on public.organizations for select to authenticated
using (id=public.current_company_id() or public.is_master());

-- Access lifecycle.
create or replace function public.master_revoke_company_access(p_request_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_company uuid;
begin
  if not public.is_master() then raise exception 'Master access required'; end if;
  update public.master_company_access_requests set revoked_at=now()
  where id=p_request_id and master_profile_id=auth.uid() returning company_id into v_company;
  if v_company is null then raise exception 'Access request not found'; end if;
  insert into public.master_audit_log(master_profile_id,company_id,access_request_id,action,entity_type,entity_id)
  values(auth.uid(),v_company,p_request_id,'access.revoked','master_company_access_requests',p_request_id);
end $$;

-- Generic audit trail for sensitive ERP mutations.
create or replace function public.audit_company_mutation()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_company uuid; v_id uuid; v_action text;
begin
  v_company:=coalesce(new.company_id,old.company_id,new.organization_id,old.organization_id);
  v_id:=coalesce(new.id,old.id);
  v_action:=lower(tg_table_name)||'.'||lower(tg_op);
  insert into public.activity_log(organization_id,company_id,actor_profile_id,action,entity_type,entity_id,metadata)
  values(v_company,v_company,auth.uid(),v_action,tg_table_name,v_id,
    jsonb_build_object('operation',tg_op,'at',now()));
  return coalesce(new,old);
exception when others then
  return coalesce(new,old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['customers','properties','quotes','jobs','routes','visits','tasks','feedback','invoices','payments'] loop
    execute format('drop trigger if exists %I on public.%I','trg_'||t||'_audit_v511',t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_company_mutation()','trg_'||t||'_audit_v511',t);
  end loop;
end $$;

-- Health check: orphan and tenant-integrity findings for the Master control plane.
create or replace function public.master_company_health_check(p_company_id uuid default null)
returns table(company_id uuid, check_key text, severity text, issue_count bigint, description text)
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_master() then raise exception 'Master access required'; end if;
  return query
  select o.id,'customers_without_property','warning',count(c.id), 'Customers with no property'
  from organizations o left join customers c on c.company_id=o.id
  where (p_company_id is null or o.id=p_company_id)
    and c.id is not null and not exists(select 1 from properties p where p.customer_id=c.id and p.company_id=o.id)
  group by o.id
  union all
  select o.id,'jobs_without_property','critical',count(j.id),'Jobs with no property'
  from organizations o left join jobs j on j.company_id=o.id
  where (p_company_id is null or o.id=p_company_id) and j.id is not null and j.property_id is null
  group by o.id
  union all
  select o.id,'visits_without_job','critical',count(v.id),'Visits with no job'
  from organizations o left join visits v on v.company_id=o.id
  where (p_company_id is null or o.id=p_company_id) and v.id is not null and v.job_id is null
  group by o.id
  union all
  select o.id,'tasks_without_source','warning',count(t.id),'Tasks with no source visit'
  from organizations o left join tasks t on t.company_id=o.id
  where (p_company_id is null or o.id=p_company_id) and t.id is not null and t.source_visit_id is null
  group by o.id;
end $$;

-- Company dashboard and operational health score.
create or replace function public.company_operational_dashboard(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; issues bigint; total_visits bigint; completed bigint; pending_tasks bigint; score int;
begin
  if not (p_company_id=public.current_company_id() or public.is_master() or public.master_has_company_access(p_company_id,'read_only')) then
    raise exception 'Company access denied';
  end if;
  select count(*) into total_visits from visits where company_id=p_company_id;
  select count(*) into completed from visits where company_id=p_company_id and status='completed';
  select count(*) into pending_tasks from tasks where company_id=p_company_id and status not in ('resolved','cancelled');
  select coalesce(sum(issue_count),0) into issues from public.master_company_health_check(p_company_id);
  score:=greatest(0,least(100,100-(issues*8)::int-(pending_tasks*2)::int + case when total_visits>0 then ((completed::numeric/total_visits)*10)::int else 0 end));
  select jsonb_build_object(
    'customers',(select count(*) from customers where company_id=p_company_id),
    'employees',(select count(*) from employees where company_id=p_company_id and active),
    'jobs',(select count(*) from jobs where company_id=p_company_id and active),
    'routes_today',(select count(*) from routes where company_id=p_company_id and route_date=current_date),
    'visits_today',(select count(*) from visits where company_id=p_company_id and scheduled_date=current_date),
    'completed_today',(select count(*) from visits where company_id=p_company_id and scheduled_date=current_date and status='completed'),
    'pending_tasks',pending_tasks,
    'health_issues',issues,
    'health_score',score
  ) into result;
  return result;
end $$;

commit;
