-- Allow authenticated users to create or update their own profile row
-- when the auth trigger has not populated it yet.

begin;

create policy if not exists profiles_self_insert
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

create policy if not exists profiles_self_update
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

commit;
