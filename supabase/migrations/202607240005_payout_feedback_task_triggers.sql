-- Damasio OS V51.8.4 - automatically release or hold payout items from feedback/tasks.
begin;

create or replace function public.refresh_payout_from_feedback()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.visit_id is not null and coalesce(new.rating,0)>=4 then
    update public.company_payout_items
      set feedback_id=new.id, updated_at=now()
      where company_id=new.company_id and visit_id=new.visit_id and status in('pending_feedback','held_task','eligible');
    perform public.refresh_payout_release_status(id)
    from public.company_payout_items
    where company_id=new.company_id and visit_id=new.visit_id and status in('pending_feedback','held_task','eligible');
  end if;
  return new;
end $$;

create or replace function public.hold_payout_from_open_task()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status::text not in('resolved','cancelled') then
    update public.company_payout_items
      set status='held_task',
          task_id=new.id,
          hold_reason='Open customer or Master task is blocking release.',
          eligible_at=null,
          updated_at=now()
      where company_id=new.company_id
        and status in('pending_feedback','eligible','approved')
        and (
          visit_id=new.source_visit_id
          or (property_id is not null and property_id=new.property_id and created_at<=new.created_at)
        );
  else
    perform public.refresh_payout_release_status(id)
    from public.company_payout_items
    where company_id=new.company_id
      and status='held_task'
      and (task_id=new.id or visit_id=new.source_visit_id or property_id=new.property_id);
  end if;
  return new;
end $$;

drop trigger if exists feedback_refreshes_payout_release on public.feedback;
create trigger feedback_refreshes_payout_release
after insert or update of rating on public.feedback
for each row execute function public.refresh_payout_from_feedback();

drop trigger if exists task_holds_or_refreshes_payout on public.tasks;
create trigger task_holds_or_refreshes_payout
after insert or update of status on public.tasks
for each row execute function public.hold_payout_from_open_task();

revoke all on function public.refresh_payout_from_feedback() from public,anon,authenticated;
revoke all on function public.hold_payout_from_open_task() from public,anon,authenticated;
grant execute on function public.refresh_payout_from_feedback() to service_role;
grant execute on function public.hold_payout_from_open_task() to service_role;

commit;
