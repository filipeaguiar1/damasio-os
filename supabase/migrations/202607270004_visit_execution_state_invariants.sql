begin;

-- Visit execution state invariants.
-- Safe repairs run before the trigger is installed so old scheduled timers cannot
-- appear as completed work in Employee, Admin, Customer or billing views.

update public.visits
set started_at = null,
    finished_at = null,
    duration_seconds = null
where status::text in ('scheduled', 'cancelled')
  and (started_at is not null or finished_at is not null or duration_seconds is not null);

update public.visits
set finished_at = null,
    duration_seconds = null
where status::text = 'in_progress'
  and (finished_at is not null or duration_seconds is not null);

create or replace function public.enforce_visit_execution_state()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text := new.status::text;
  v_old_status text := case when tg_op = 'UPDATE' then old.status::text else null end;
  v_context text := coalesce(current_setting('damasio.visit_transition_context', true), '');
begin
  if new.duration_seconds is not null and new.duration_seconds < 0 then
    raise exception 'Visit duration cannot be negative.';
  end if;

  if v_status in ('scheduled', 'cancelled') then
    if new.started_at is not null or new.finished_at is not null or new.duration_seconds is not null then
      raise exception '% Visit cannot contain execution timestamps or duration.', initcap(v_status);
    end if;
  elsif v_status = 'in_progress' then
    if new.started_at is null or new.finished_at is not null or new.duration_seconds is not null then
      raise exception 'An active Visit requires started_at and cannot contain finished_at or duration_seconds.';
    end if;
  elsif v_status = 'completed' then
    if new.started_at is null or new.finished_at is null or new.duration_seconds is null then
      raise exception 'A completed Visit requires started_at, finished_at and duration_seconds.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if v_old_status = 'scheduled' and v_status = 'completed' then
      raise exception 'Start this Visit before finishing it.';
    end if;

    if v_old_status = 'completed'
       and v_status <> 'completed'
       and v_context <> 'reopen_completed_visit' then
      raise exception 'Completed work can only return to Open through the audited Reopen flow.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists visits_execution_state_invariants on public.visits;
create trigger visits_execution_state_invariants
before insert or update of status, started_at, finished_at, duration_seconds
on public.visits
for each row execute function public.enforce_visit_execution_state();

commit;
