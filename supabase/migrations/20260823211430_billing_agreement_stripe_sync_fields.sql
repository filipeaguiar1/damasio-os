alter table public.billing_agreements
  add column if not exists stripe_sync_error text,
  add column if not exists stripe_synced_at timestamptz;
