-- Damasio OS / 4 Ever Seasons — external Stripe payout reconciliation + Master manual invoice audit.
-- Prevents dashboard-created payouts from bypassing the internal receivables ledger.
begin;

alter table public.organizations
  add column if not exists stripe_payout_reconciliation_hold boolean not null default false,
  add column if not exists stripe_payout_reconciliation_note text,
  add column if not exists stripe_payout_reconciled_at timestamptz;

alter table public.company_withdrawals
  add column if not exists origin text not null default 'platform',
  add column if not exists stripe_event_id text,
  add column if not exists unmatched_cents bigint not null default 0;

alter table public.company_withdrawals
  drop constraint if exists company_withdrawals_origin_check;
alter table public.company_withdrawals
  add constraint company_withdrawals_origin_check
  check(origin in('platform','stripe_dashboard','safety'));

create unique index if not exists company_withdrawals_stripe_event_unique
  on public.company_withdrawals(stripe_event_id)
  where stripe_event_id is not null;

alter table public.invoices
  add column if not exists manual_description text,
  add column if not exists manual_created_by_profile_id uuid references public.profiles(id) on delete set null;

create or replace function public.reserve_external_company_payout(
  p_company_id uuid,
  p_amount_cents bigint,
  p_stripe_payout_id text,
  p_stripe_event_id text
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_existing uuid;
  v_withdrawal uuid;
  v_available bigint;
  v_remaining bigint;
  v_piece bigint;
  v_row record;
begin
  if p_company_id is null or coalesce(p_amount_cents,0)<1 or coalesce(trim(p_stripe_payout_id),'')='' then
    raise exception 'Invalid external Stripe payout';
  end if;

  select id into v_existing
  from public.company_withdrawals
  where stripe_payout_id=p_stripe_payout_id
     or (p_stripe_event_id is not null and stripe_event_id=p_stripe_event_id)
  order by requested_at
  limit 1;
  if v_existing is not null then return v_existing; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));

  select coalesce(sum(amount_cents-paid_out_cents-reserved_cents),0)::bigint
  into v_available
  from public.company_balance_entries
  where company_id=p_company_id and state='available';

  insert into public.company_withdrawals(
    company_id,requested_by_profile_id,amount_cents,status,system_generated,
    stripe_payout_id,stripe_event_id,internal_available_cents_at_request,
    origin,unmatched_cents,processed_at
  ) values(
    p_company_id,null,p_amount_cents,'processing',true,
    p_stripe_payout_id,p_stripe_event_id,v_available,
    'stripe_dashboard',greatest(0,p_amount_cents-v_available),now()
  ) returning id into v_withdrawal;

  v_remaining:=least(p_amount_cents,v_available);
  for v_row in
    select id,amount_cents,paid_out_cents,reserved_cents
    from public.company_balance_entries
    where company_id=p_company_id
      and state='available'
      and amount_cents-paid_out_cents-reserved_cents>0
    order by released_at nulls last,created_at,id
    for update
  loop
    exit when v_remaining<=0;
    v_piece:=least(v_remaining,v_row.amount_cents-v_row.paid_out_cents-v_row.reserved_cents);
    update public.company_balance_entries
      set reserved_cents=reserved_cents+v_piece,updated_at=now()
      where id=v_row.id;
    insert into public.company_withdrawal_allocations(withdrawal_id,balance_entry_id,amount_cents)
      values(v_withdrawal,v_row.id,v_piece)
      on conflict(withdrawal_id,balance_entry_id) do nothing;
    v_remaining:=v_remaining-v_piece;
  end loop;

  if p_amount_cents>v_available then
    update public.organizations
      set stripe_payout_reconciliation_hold=true,
          stripe_payout_reconciliation_note='External Stripe payout exceeded the internally released balance. Further withdrawals are blocked until Master review.',
          stripe_payout_reconciled_at=now()
      where id=p_company_id;
  end if;

  return v_withdrawal;
end $$;

create or replace function public.complete_external_company_withdrawal(
  p_withdrawal_id uuid,
  p_stripe_payout_id text
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_w public.company_withdrawals%rowtype;
  v_alloc record;
begin
  select * into v_w from public.company_withdrawals where id=p_withdrawal_id for update;
  if v_w.id is null then raise exception 'Withdrawal not found'; end if;
  if v_w.status='paid' then return; end if;
  if v_w.status not in('reserved','processing') then raise exception 'Withdrawal is not payable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_w.company_id::text,0));

  for v_alloc in select * from public.company_withdrawal_allocations where withdrawal_id=v_w.id loop
    update public.company_balance_entries
      set reserved_cents=greatest(0,reserved_cents-v_alloc.amount_cents),
          paid_out_cents=paid_out_cents+v_alloc.amount_cents,
          state=case when paid_out_cents+v_alloc.amount_cents>=amount_cents then 'paid_out' else 'available' end,
          updated_at=now()
      where id=v_alloc.balance_entry_id;
  end loop;

  update public.company_withdrawals
    set status='paid',stripe_payout_id=coalesce(p_stripe_payout_id,stripe_payout_id),
        paid_at=now(),processed_at=now(),updated_at=now()
    where id=v_w.id;

  update public.organizations
    set stripe_payout_reconciled_at=now()
    where id=v_w.company_id;
end $$;

create or replace function public.clear_company_payout_reconciliation_hold(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.profiles where id=auth.uid() and active and role::text='master'
  ) then raise exception 'Only Master can clear payout reconciliation hold'; end if;

  update public.organizations
    set stripe_payout_reconciliation_hold=false,
        stripe_payout_reconciliation_note=null,
        stripe_payout_reconciled_at=now()
    where id=p_company_id;
end $$;

revoke all on function public.reserve_external_company_payout(uuid,bigint,text,text) from public,anon,authenticated;
revoke all on function public.complete_external_company_withdrawal(uuid,text) from public,anon,authenticated;
revoke all on function public.clear_company_payout_reconciliation_hold(uuid) from public,anon;
grant execute on function public.reserve_external_company_payout(uuid,bigint,text,text) to service_role;
grant execute on function public.complete_external_company_withdrawal(uuid,text) to service_role;
grant execute on function public.clear_company_payout_reconciliation_hold(uuid) to authenticated;

commit;
