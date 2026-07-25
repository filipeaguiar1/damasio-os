begin;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.customer_wallets to service_role;
grant select, insert, update, delete on table public.customer_wallet_transactions to service_role;
grant select, insert, update, delete on table public.customer_tips to service_role;

grant execute on function public.credit_customer_wallet(uuid,uuid,bigint,text,text) to service_role;
grant execute on function public.pay_customer_tip_from_wallet(uuid,uuid,bigint,text) to service_role;

commit;
