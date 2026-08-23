alter table public.invoices
  add column if not exists customer_notified_at timestamptz,
  add column if not exists customer_notification_attempted_at timestamptz,
  add column if not exists customer_notification_error text;

create index if not exists invoices_monthly_notification_pending_idx
  on public.invoices(created_at)
  where billing_cycle_id is not null and customer_notified_at is null;
