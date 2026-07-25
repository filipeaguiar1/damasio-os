begin;

alter table public.customers
  add column if not exists customer_service_price numeric(12,2),
  add column if not exists company_service_payout numeric(12,2),
  add column if not exists platform_service_margin numeric(12,2);

update public.customers
set company_service_payout = coalesce(company_service_payout, offered_service_price),
    platform_service_margin = case
      when customer_service_price is not null and coalesce(company_service_payout, offered_service_price) is not null
        then greatest(customer_service_price - coalesce(company_service_payout, offered_service_price), 0)
      else platform_service_margin
    end;

alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists address_line1 text,
  add column if not exists city text,
  add column if not exists province text default 'ON',
  add column if not exists postal_code text,
  add column if not exists route_start_address text,
  add column if not exists invite_status text default 'pending';

alter table public.employees
  add column if not exists avatar_url text,
  add column if not exists address_line1 text,
  add column if not exists city text,
  add column if not exists province text default 'ON',
  add column if not exists postal_code text,
  add column if not exists route_start_address text,
  add column if not exists invite_status text default 'pending';

insert into storage.buckets (id, name, public)
values ('employee-avatars', 'employee-avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Company members read employee avatars" on storage.objects;
create policy "Company members read employee avatars"
on storage.objects for select
to authenticated
using (bucket_id = 'employee-avatars');

drop policy if exists "Authenticated users upload employee avatars" on storage.objects;
create policy "Authenticated users upload employee avatars"
on storage.objects for insert
to authenticated
with check (bucket_id = 'employee-avatars');

drop policy if exists "Authenticated users update employee avatars" on storage.objects;
create policy "Authenticated users update employee avatars"
on storage.objects for update
to authenticated
using (bucket_id = 'employee-avatars')
with check (bucket_id = 'employee-avatars');

create index if not exists customers_offer_company_status_idx
  on public.customers(service_company_id, offer_status)
  where archived_at is null;

comment on column public.customers.customer_service_price is
  'Gross CAD amount charged to the customer by the platform.';
comment on column public.customers.company_service_payout is
  'CAD amount offered and payable to the servicing company.';
comment on column public.customers.platform_service_margin is
  'Internal platform margin. Never exposed to servicing companies or customers.';

commit;