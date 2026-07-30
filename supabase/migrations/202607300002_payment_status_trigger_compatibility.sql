begin;

-- Payments.status is the payment_status enum. Comparing the enum directly with
-- legacy text values such as "completed" or "succeeded" raises an enum cast
-- error before the trigger can finish. Compare normalized text values instead
-- so canonical "paid" payments can safely mark customers ready for assignment.
create or replace function public.mark_customer_ready_after_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_status text := coalesce(new.status::text, '');
  v_old_status text := null;
begin
  if tg_op <> 'INSERT' then
    v_old_status := old.status::text;
  end if;

  if v_new_status in ('paid', 'completed', 'succeeded')
     and v_old_status is distinct from v_new_status
     and new.customer_id is not null then
    update public.customers
    set first_payment_at = coalesce(first_payment_at, now()),
        assignment_status = case
          when service_company_id is not null then 'assigned'
          else 'ready_for_assignment'
        end
    where id = new.customer_id;
  end if;

  return new;
end;
$$;

commit;
