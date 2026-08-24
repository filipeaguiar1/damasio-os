-- 4Ever Seasons Master platform earnings ledger.
-- Keeps platform revenue separate from Customer Wallet and Company Balance.
begin;

create table if not exists public.master_balance_entries (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  company_id uuid references public.organizations(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  stripe_payment_intent_id text not null,
  stripe_charge_id text,
  currency text not null default 'cad',
  gross_payment_cents bigint not null check (gross_payment_cents >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  state text not null default 'available' check (state in ('available','disputed','refunded','reversed')),
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists master_balance_entries_payment_intent_unique
  on public.master_balance_entries(stripe_payment_intent_id);
create unique index if not exists master_balance_entries_payment_unique
  on public.master_balance_entries(payment_id)
  where payment_id is not null;
create index if not exists master_balance_entries_state_created_idx
  on public.master_balance_entries(state, created_at desc);

create table if not exists public.master_balance_entry_events (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.master_balance_entries(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete set null,
  event_type text not null check (event_type in ('created','state_changed')),
  previous_state text,
  new_state text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists master_balance_entry_events_entry_created_idx
  on public.master_balance_entry_events(entry_id, created_at desc);

alter table public.master_balance_entries enable row level security;
alter table public.master_balance_entry_events enable row level security;
revoke all on public.master_balance_entries from anon, authenticated;
revoke all on public.master_balance_entry_events from anon, authenticated;

create or replace function public.audit_master_balance_entry()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='INSERT' then
    insert into public.master_balance_entry_events(
      entry_id,payment_id,event_type,previous_state,new_state,amount_cents,reason
    ) values (
      new.id,new.payment_id,'created',null,new.state,new.amount_cents,new.status_reason
    );
  elsif old.state is distinct from new.state then
    insert into public.master_balance_entry_events(
      entry_id,payment_id,event_type,previous_state,new_state,amount_cents,reason
    ) values (
      new.id,new.payment_id,'state_changed',old.state,new.state,new.amount_cents,new.status_reason
    );
  end if;
  return new;
end $$;

revoke all on function public.audit_master_balance_entry() from public,anon,authenticated;

drop trigger if exists master_balance_entry_audit_trg on public.master_balance_entries;
create trigger master_balance_entry_audit_trg
after insert or update of state on public.master_balance_entries
for each row execute function public.audit_master_balance_entry();

create or replace function public.sync_master_balance_from_payment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_fee_cents bigint:=0;
  v_gross_cents bigint:=0;
  v_pi text:=nullif(trim(coalesce(new.stripe_payment_intent_id,'')),'');
begin
  if new.status::text='refunded' then
    update public.master_balance_entries
    set state='refunded',status_reason='Canonical Stripe payment refunded.',updated_at=now()
    where (payment_id=new.id or (v_pi is not null and stripe_payment_intent_id=v_pi))
      and state<>'refunded';
    return new;
  end if;

  if new.status::text not in ('paid','succeeded') or new.invoice_id is null or v_pi is null then
    return new;
  end if;

  select * into v_invoice from public.invoices where id=new.invoice_id;
  if not found then return new; end if;

  v_fee_cents:=greatest(0,round(coalesce(v_invoice.stripe_platform_fee,0)*100)::bigint);
  v_gross_cents:=greatest(0,round(coalesce(v_invoice.total,0)*100)::bigint);
  if v_fee_cents=0 then return new; end if;

  insert into public.master_balance_entries(
    payment_id,invoice_id,company_id,customer_id,
    stripe_payment_intent_id,stripe_charge_id,currency,
    gross_payment_cents,amount_cents,state,status_reason
  ) values (
    new.id,new.invoice_id,
    v_invoice.organization_id,
    v_invoice.customer_id,
    v_pi,nullif(trim(coalesce(new.stripe_charge_id,'')),''),'cad',
    v_gross_cents,v_fee_cents,'available','Platform fee earned from a canonical paid invoice.'
  )
  on conflict (stripe_payment_intent_id) do update set
    payment_id=excluded.payment_id,
    invoice_id=excluded.invoice_id,
    company_id=excluded.company_id,
    customer_id=excluded.customer_id,
    stripe_charge_id=coalesce(excluded.stripe_charge_id,public.master_balance_entries.stripe_charge_id),
    gross_payment_cents=excluded.gross_payment_cents,
    amount_cents=excluded.amount_cents,
    updated_at=now();

  return new;
end $$;

revoke all on function public.sync_master_balance_from_payment() from public,anon,authenticated;

drop trigger if exists payments_sync_master_balance_trg on public.payments;
create trigger payments_sync_master_balance_trg
after insert or update of status,stripe_payment_intent_id,stripe_charge_id on public.payments
for each row execute function public.sync_master_balance_from_payment();

create or replace function public.sync_master_balance_from_company_payout()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_payment_status text;
begin
  if new.payment_id is null then return new; end if;

  if new.status='disputed' then
    update public.master_balance_entries
    set state='disputed',status_reason='Underlying Stripe payment is under dispute.',updated_at=now()
    where payment_id=new.payment_id and state not in ('refunded','reversed','disputed');
    return new;
  end if;

  if new.status='refunded' then
    update public.master_balance_entries
    set state='refunded',status_reason='Underlying payment/payout was refunded.',updated_at=now()
    where payment_id=new.payment_id and state<>'refunded';
    return new;
  end if;

  if tg_op='UPDATE' and old.status='disputed' and new.status not in ('disputed','refunded') then
    select status::text into v_payment_status from public.payments where id=new.payment_id;
    if v_payment_status in ('paid','succeeded') then
      update public.master_balance_entries
      set state='available',status_reason='Payment dispute no longer blocks the Master earning.',updated_at=now()
      where payment_id=new.payment_id and state='disputed';
    end if;
  end if;

  return new;
end $$;

revoke all on function public.sync_master_balance_from_company_payout() from public,anon,authenticated;

drop trigger if exists payout_sync_master_balance_trg on public.company_payout_items;
create trigger payout_sync_master_balance_trg
after insert or update of status on public.company_payout_items
for each row execute function public.sync_master_balance_from_company_payout();

create or replace function public.master_balance_summary()
returns jsonb
language sql
security definer
set search_path=public
stable
as $$
  select jsonb_build_object(
    'availableCents',coalesce(sum(amount_cents) filter(where state='available'),0),
    'disputedCents',coalesce(sum(amount_cents) filter(where state='disputed'),0),
    'refundedCents',coalesce(sum(amount_cents) filter(where state='refunded'),0),
    'reversedCents',coalesce(sum(amount_cents) filter(where state='reversed'),0),
    'recordedCents',coalesce(sum(amount_cents),0),
    'entryCount',count(*)
  )
  from public.master_balance_entries;
$$;

revoke all on function public.master_balance_summary() from public,anon,authenticated;
grant execute on function public.master_balance_summary() to service_role;

insert into public.master_balance_entries(
  payment_id,invoice_id,company_id,customer_id,
  stripe_payment_intent_id,stripe_charge_id,currency,
  gross_payment_cents,amount_cents,state,status_reason
)
select
  p.id,p.invoice_id,
  i.organization_id,i.customer_id,
  p.stripe_payment_intent_id,p.stripe_charge_id,'cad',
  greatest(0,round(coalesce(i.total,0)*100)::bigint),
  greatest(0,round(coalesce(i.stripe_platform_fee,0)*100)::bigint),
  case
    when p.status::text='refunded' then 'refunded'
    when exists(select 1 from public.company_payout_items cpi where cpi.payment_id=p.id and cpi.status='disputed') then 'disputed'
    when exists(select 1 from public.company_payout_items cpi where cpi.payment_id=p.id and cpi.status='refunded') then 'refunded'
    else 'available'
  end,
  'Backfilled from canonical invoice/payment records.'
from public.payments p
join public.invoices i on i.id=p.invoice_id
where p.stripe_payment_intent_id is not null
  and p.status::text in ('paid','succeeded','refunded')
  and coalesce(i.stripe_platform_fee,0)>0
on conflict (stripe_payment_intent_id) do nothing;

commit;
