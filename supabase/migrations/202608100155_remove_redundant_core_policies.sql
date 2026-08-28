begin;

-- `profiles_own` already grants the exact same own-profile SELECT to authenticated users.
drop policy if exists profiles_read_own_profile on public.profiles;

-- `employees_company_operator_select` already contains profile_id = auth.uid()
-- as its first branch, so this second permissive policy is redundant.
drop policy if exists employees_self on public.employees;

commit;
