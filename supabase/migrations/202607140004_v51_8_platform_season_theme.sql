-- Damasio OS V51.8 — one Master-controlled seasonal theme for every device.
begin;
create table if not exists public.platform_theme_settings(
  singleton boolean primary key default true check(singleton),
  season_mode text not null default 'auto' check(season_mode in('auto','manual')),
  season text not null default 'summer' check(season in('spring','summer','autumn','winter')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.platform_theme_settings(singleton) values(true) on conflict(singleton) do nothing;
alter table public.platform_theme_settings enable row level security;
drop policy if exists platform_theme_public_read on public.platform_theme_settings;
create policy platform_theme_public_read on public.platform_theme_settings for select using(true);

create or replace function public.get_platform_season_theme()
returns table(season_mode text,season text,updated_at timestamptz)
language sql stable security definer set search_path=public as $$select season_mode,season,updated_at from platform_theme_settings where singleton$$;
grant execute on function public.get_platform_season_theme() to anon,authenticated;

create or replace function public.set_platform_season_theme(p_mode text,p_season text)
returns table(season_mode text,season text,updated_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.is_master() then raise exception 'Master authentication required'; end if;
  if p_mode not in('auto','manual') or p_season not in('spring','summer','autumn','winter') then raise exception 'Invalid season theme'; end if;
  update platform_theme_settings set season_mode=p_mode,season=p_season,updated_by=auth.uid(),updated_at=now() where singleton;
  return query select t.season_mode,t.season,t.updated_at from platform_theme_settings t where singleton;
end $$;
revoke all on function public.set_platform_season_theme(text,text) from public,anon;
grant execute on function public.set_platform_season_theme(text,text) to authenticated;
commit;
