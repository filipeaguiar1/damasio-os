-- Restore the deferrable route-position constraint required by
-- publish_canonical_route_daily in environments where the RPC was installed
-- without the preceding V53 integrity migration.

begin;

do $$
declare
  v_duplicate_groups integer;
begin
  select count(*)
  into v_duplicate_groups
  from (
    select route_id, route_order
    from public.visits
    where route_id is not null
      and route_order is not null
    group by route_id, route_order
    having count(*) > 1
  ) duplicates;

  if v_duplicate_groups > 0 then
    raise exception
      'Cannot restore visits_route_order_unique: % duplicate route position group(s) require repair first.',
      v_duplicate_groups;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'visits_route_order_unique'
      and conrelid = 'public.visits'::regclass
  ) then
    alter table public.visits
      add constraint visits_route_order_unique
      unique (route_id, route_order)
      deferrable initially deferred;
  end if;
end
$$;

commit;
