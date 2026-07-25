begin;

alter table public.customers
  add column if not exists offered_service_price numeric(12,2),
  add column if not exists offer_status text,
  add column if not exists offer_sent_at timestamptz,
  add column if not exists offer_responded_at timestamptz,
  add column if not exists offer_response_note text;

update public.customers
set offer_status = case
  when assignment_status in ('accepted','active') then 'accepted'
  when assignment_status in ('declined','rejected') then 'declined'
  when service_company_id is not null then 'accepted'
  else null
end
where offer_status is null;

create index if not exists customers_company_offer_status_idx
  on public.customers(service_company_id, offer_status)
  where archived_at is null;

comment on column public.customers.offered_service_price is
  'Amount in CAD offered by Master to the assigned service company for this property/customer service.';
comment on column public.customers.offer_status is
  'Canonical company response state: offered, accepted, declined, cancelled.';

commit;
