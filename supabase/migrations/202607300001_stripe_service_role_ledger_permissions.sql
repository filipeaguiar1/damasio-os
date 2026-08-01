begin;

-- Stripe webhook and wallet routes run only on trusted server code with the
-- Supabase service_role key. Keep browser roles unchanged and grant only the
-- ledger operations required by the canonical payment lifecycle.
grant select, insert, update on table public.payments to service_role;
grant select, insert, update on table public.company_payout_items to service_role;
grant select, insert, update on table public.stripe_webhook_events to service_role;
grant select, insert, update on table public.activity_log to service_role;
grant select, insert, update on table public.customer_wallets to service_role;
grant select, insert, update on table public.customer_wallet_transactions to service_role;
grant select, insert, update on table public.customer_deposit_invoices to service_role;

commit;
