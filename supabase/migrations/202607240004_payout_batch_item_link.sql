-- Damasio OS V51.8.3 - connect payout items to their weekly batch.
begin;

alter table public.company_payout_items add column if not exists batch_id uuid references public.company_payout_batches(id) on delete set null;
create index if not exists company_payout_items_batch_idx
  on public.company_payout_items(batch_id) where batch_id is not null;

commit;
