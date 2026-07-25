begin;

create table if not exists public.customer_tips (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  company_id uuid references public.organizations(id) on delete set null,
  amount_cents bigint not null check (amount_cents >= 100),
  stripe_payment_intent_id text not null unique,
  status text not null default 'paid' check (status in ('paid','refunded','disputed')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists customer_tips_customer_created_idx on public.customer_tips(customer_id, created_at desc);
alter table public.customer_tips enable row level security;
revoke all on public.customer_tips from anon, authenticated;
grant select on public.customer_tips to authenticated;

drop policy if exists customer_tips_read_own on public.customer_tips;
create policy customer_tips_read_own on public.customer_tips for select to authenticated using (
  exists (select 1 from public.customers c where c.id = customer_tips.customer_id and c.profile_id = auth.uid() and c.archived_at is null)
);

commit;
