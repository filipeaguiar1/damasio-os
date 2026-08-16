create index if not exists temporary_test_accounts_created_by_master_idx on public.temporary_test_accounts(created_by_master_id);
create index if not exists temporary_test_accounts_customer_idx on public.temporary_test_accounts(customer_id) where customer_id is not null;
create index if not exists temporary_test_accounts_employee_idx on public.temporary_test_accounts(employee_id) where employee_id is not null;
