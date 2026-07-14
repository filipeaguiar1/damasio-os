-- Damasio OS V51.6 — safe, reversible customer removal.
begin;

alter table public.customers add column if not exists archived_at timestamptz;
create index if not exists customers_company_archived_idx on public.customers(company_id,archived_at);

create or replace function public.archive_company_customers(p_customer_ids uuid[])
returns integer language plpgsql security definer set search_path=public as $$
declare v_company uuid:=public.current_company_id();v_archived integer:=0;
begin
  if auth.uid() is null or v_company is null then raise exception 'Authenticated company Admin required'; end if;
  if coalesce(array_length(p_customer_ids,1),0)=0 then return 0; end if;

  update customers set archived_at=now()
  where company_id=v_company and id=any(p_customer_ids) and archived_at is null;
  get diagnostics v_archived=row_count;

  -- Stop new work without destroying financial, visit, photo or service history.
  update jobs set active=false
  where company_id=v_company and customer_id=any(p_customer_ids) and active;
  update visits set status='cancelled'
  where company_id=v_company and customer_id=any(p_customer_ids)
    and scheduled_date>=current_date and status='scheduled';

  return v_archived;
end $$;

revoke all on function public.archive_company_customers(uuid[]) from public,anon;
grant execute on function public.archive_company_customers(uuid[]) to authenticated;

create or replace function public.get_customer_property_directory()
returns table(customer_id uuid,property_id uuid,full_name text,email text,phone text,customer_notes text,address_line1 text,city text,province text,postal_code text,lot_size text,grass_height text,gate boolean,dog boolean,irrigation boolean,access_notes text,property_notes text,created_at timestamptz)
language sql security definer set search_path=public as $$
  select c.id,p.id,c.full_name,c.email,c.phone,c.notes,p.address_line1,p.city,p.province,p.postal_code,p.lot_size::text,p.grass_height::text,p.gate,p.dog,p.irrigation,p.access_notes,p.property_notes,p.created_at
  from customers c join properties p on p.customer_id=c.id
  where c.company_id=coalesce(public.current_company_id(),'00000000-0000-0000-0000-000000000001'::uuid)
    and c.archived_at is null
  order by p.created_at desc;
$$;
grant execute on function public.get_customer_property_directory() to anon,authenticated;

commit;
