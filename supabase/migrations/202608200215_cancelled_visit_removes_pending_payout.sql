begin;

create or replace function public.cancel_pending_payout_for_cancelled_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_ids uuid[];
  v_batch_id uuid;
begin
  if new.status::text <> 'cancelled' or old.status::text = 'cancelled' then
    return new;
  end if;

  select coalesce(array_agg(distinct batch_id) filter (where batch_id is not null), '{}'::uuid[])
  into v_batch_ids
  from public.company_payout_items
  where visit_id = new.id
    and status in ('pending_feedback','held_task','eligible','approved');

  update public.company_payout_items
  set status = 'cancelled',
      hold_reason = 'Service Visit was cancelled before payout transfer.',
      eligible_at = null,
      approved_by_master_id = null,
      approved_at = null,
      cancelled_at = coalesce(cancelled_at, clock_timestamp()),
      batch_id = null,
      updated_at = clock_timestamp()
  where visit_id = new.id
    and status in ('pending_feedback','held_task','eligible','approved');

  foreach v_batch_id in array v_batch_ids loop
    update public.company_payout_items
    set status = 'eligible',
        approved_by_master_id = null,
        approved_at = null,
        updated_at = clock_timestamp()
    where batch_id = v_batch_id
      and status = 'approved';

    update public.company_payout_batches b
    set status = 'draft',
        total_transfer_amount = coalesce((
          select sum(i.transfer_amount)
          from public.company_payout_items i
          where i.batch_id = b.id
            and i.status = 'eligible'
        ), 0),
        approved_by_master_id = null,
        approved_at = null
    where b.id = v_batch_id
      and b.status in ('draft','approved');
  end loop;

  return new;
end;
$$;

revoke all on function public.cancel_pending_payout_for_cancelled_visit() from public, anon, authenticated;
grant execute on function public.cancel_pending_payout_for_cancelled_visit() to service_role;

drop trigger if exists cancelled_visit_removes_pending_payout on public.visits;
create trigger cancelled_visit_removes_pending_payout
after update of status on public.visits
for each row
when (new.status = 'cancelled' and old.status is distinct from new.status)
execute function public.cancel_pending_payout_for_cancelled_visit();

commit;
