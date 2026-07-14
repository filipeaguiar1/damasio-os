-- Damasio OS V51.7 — quote review, customer invitation and payment foundation.
-- This migration stores workflow state only. It does not send email or charge money.
begin;

alter table public.quotes add column if not exists master_reviewed_at timestamptz;
alter table public.quotes add column if not exists customer_decided_at timestamptz;
alter table public.quotes add column if not exists customer_email text;
alter table public.quotes add column if not exists revision_note text;
alter table public.payments add column if not exists failure_code text;
alter table public.payments add column if not exists failure_message text;
alter table public.visits add column if not exists payment_hold boolean not null default false;

create table if not exists public.quote_invitations(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  email text not null,
  token_hash text,
  status text not null default 'pending' check(status in('pending','sent','claimed','expired','revoked')),
  sent_at timestamptz,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique(quote_id,email)
);

create table if not exists public.customer_payment_profiles(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  primary_source text not null default 'stripe' check(primary_source in('stripe','account_balance')),
  stripe_customer_id text,
  automatic_payments_authorized boolean not null default false,
  authorization_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,customer_id)
);

create table if not exists public.account_balance_transactions(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete set null,
  amount numeric(12,2) not null check(amount<>0),
  kind text not null check(kind in('deposit','charge','refund','adjustment')),
  status text not null default 'pending' check(status in('pending','completed','failed','reversed')),
  provider_reference text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists quote_invitations_company_status_idx on public.quote_invitations(company_id,status,created_at desc);
create index if not exists balance_transactions_customer_idx on public.account_balance_transactions(company_id,customer_id,created_at desc);
alter table public.quote_invitations enable row level security;
alter table public.customer_payment_profiles enable row level security;
alter table public.account_balance_transactions enable row level security;

create or replace function public.claim_quote_by_number(p_quote_number text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_quote quotes%rowtype;v_email text:=lower(coalesce(auth.jwt()->>'email',''));v_customer uuid;
begin
  if auth.uid() is null or v_email='' then raise exception 'Authenticated email required'; end if;
  select * into v_quote from quotes where upper(quote_number)=upper(trim(p_quote_number)) and status='sent' for update;
  if v_quote.id is null then raise exception 'Quote is not available for claiming'; end if;
  if lower(coalesce(v_quote.customer_email,(select email from customers where id=v_quote.customer_id),''))<>v_email then raise exception 'Email does not match this quote'; end if;
  v_customer:=v_quote.customer_id;
  if v_customer is null then raise exception 'Quote has no customer record'; end if;
  update customers set profile_id=auth.uid() where id=v_customer and company_id=v_quote.company_id and (profile_id is null or profile_id=auth.uid());
  if not found then raise exception 'Customer account is already linked'; end if;
  update quote_invitations set status='claimed',claimed_by=auth.uid(),claimed_at=now() where quote_id=v_quote.id and email ilike v_email;
  return v_quote.id;
end $$;
revoke all on function public.claim_quote_by_number(text) from public,anon;
grant execute on function public.claim_quote_by_number(text) to authenticated;

commit;
