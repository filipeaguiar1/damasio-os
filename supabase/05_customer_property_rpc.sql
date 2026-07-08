-- Damasio OS V42.1 - Customers + Properties real database bridge
-- Run this after 00_run_this_first_database_setup.sql.
-- It gives the app a controlled early-stage API while full Auth/RLS is finished.

create or replace function public.get_customer_property_directory()
returns table (
  customer_id uuid,
  property_id uuid,
  full_name text,
  email text,
  phone text,
  customer_notes text,
  address_line1 text,
  city text,
  province text,
  postal_code text,
  lot_size text,
  grass_height text,
  gate boolean,
  dog boolean,
  irrigation boolean,
  access_notes text,
  property_notes text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    c.id as customer_id,
    p.id as property_id,
    c.full_name,
    c.email,
    c.phone,
    c.notes as customer_notes,
    p.address_line1,
    p.city,
    p.province,
    p.postal_code,
    p.lot_size::text,
    p.grass_height::text,
    p.gate,
    p.dog,
    p.irrigation,
    p.access_notes,
    p.property_notes,
    p.created_at
  from customers c
  join properties p on p.customer_id = c.id
  where c.organization_id = '00000000-0000-0000-0000-000000000001'
  order by p.created_at desc;
$$;

grant execute on function public.get_customer_property_directory() to anon, authenticated;

create or replace function public.create_customer_property(
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_customer_notes text default null,
  p_address_line1 text default null,
  p_city text default 'Hamilton',
  p_province text default 'ON',
  p_postal_code text default null,
  p_lot_size text default null,
  p_grass_height text default null,
  p_gate boolean default false,
  p_dog boolean default false,
  p_irrigation boolean default false,
  p_access_notes text default null,
  p_property_notes text default null
)
returns table (
  customer_id uuid,
  property_id uuid,
  full_name text,
  email text,
  phone text,
  customer_notes text,
  address_line1 text,
  city text,
  province text,
  postal_code text,
  lot_size text,
  grass_height text,
  gate boolean,
  dog boolean,
  irrigation boolean,
  access_notes text,
  property_notes text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_customer uuid;
  v_property uuid;
begin
  if nullif(trim(p_full_name), '') is null then
    raise exception 'Customer name is required';
  end if;

  if nullif(trim(coalesce(p_address_line1, '')), '') is null then
    raise exception 'Property address is required';
  end if;

  insert into customers (organization_id, full_name, email, phone, notes)
  values (v_org, trim(p_full_name), nullif(trim(coalesce(p_email, '')), ''), nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_customer_notes, '')), ''))
  returning id into v_customer;

  insert into properties (
    organization_id, customer_id, address_line1, city, province, postal_code,
    lot_size, grass_height, gate, dog, irrigation, access_notes, property_notes
  ) values (
    v_org,
    v_customer,
    trim(p_address_line1),
    coalesce(nullif(trim(coalesce(p_city, '')), ''), 'Hamilton'),
    coalesce(nullif(trim(coalesce(p_province, '')), ''), 'ON'),
    nullif(trim(coalesce(p_postal_code, '')), ''),
    case when p_lot_size in ('xs','small','legacy','oversize') then p_lot_size else null end,
    case when p_grass_height in ('2in','3in','4in','5in') then p_grass_height else null end,
    coalesce(p_gate, false),
    coalesce(p_dog, false),
    coalesce(p_irrigation, false),
    nullif(trim(coalesce(p_access_notes, '')), ''),
    nullif(trim(coalesce(p_property_notes, '')), '')
  ) returning id into v_property;

  return query
  select * from public.get_customer_property_directory()
  where get_customer_property_directory.customer_id = v_customer
  and get_customer_property_directory.property_id = v_property;
end;
$$;

grant execute on function public.create_customer_property(text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,text,text) to anon, authenticated;
