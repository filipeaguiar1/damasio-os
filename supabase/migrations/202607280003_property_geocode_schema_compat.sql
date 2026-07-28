begin;

-- Damasio OS — compatibility repair for environments that did not receive the
-- original Instant Map Engine property columns. Customer creation and the
-- temporary route sandbox both use geocode_status, so the canonical schema must
-- provide the same fields in every company environment.

alter table public.properties
  add column if not exists geocoded_at timestamptz;

alter table public.properties
  add column if not exists geocode_provider text;

alter table public.properties
  add column if not exists geocode_status text;

update public.properties
set geocode_status = 'not_mapped'
where geocode_status is null
   or geocode_status not in ('not_mapped', 'mapped', 'failed', 'needs_review');

alter table public.properties
  alter column geocode_status set default 'not_mapped';

alter table public.properties
  alter column geocode_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'properties_geocode_status_valid'
      and conrelid = 'public.properties'::regclass
  ) then
    alter table public.properties
      add constraint properties_geocode_status_valid
      check (geocode_status in ('not_mapped', 'mapped', 'failed', 'needs_review'))
      not valid;
  end if;
end $$;

alter table public.properties
  validate constraint properties_geocode_status_valid;

comment on column public.properties.geocode_status is
  'Canonical property mapping state used by customer creation, route planning and map rebuilds.';

notify pgrst, 'reload schema';

commit;
