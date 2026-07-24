-- Damasio OS V51.8.2 - link Master lead responses to customer quote/invoice records.
begin;

alter table public.lead_center add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.lead_center add column if not exists property_id uuid references public.properties(id) on delete set null;
alter table public.lead_center add column if not exists service_request_id uuid references public.service_requests(id) on delete set null;
alter table public.lead_center add column if not exists quote_id uuid references public.quotes(id) on delete set null;
alter table public.lead_center add column if not exists invoice_id uuid references public.invoices(id) on delete set null;
alter table public.lead_center add column if not exists final_total numeric(10,2);
alter table public.lead_center add column if not exists response_message text;
alter table public.lead_center add column if not exists responded_at timestamptz;
alter table public.lead_center add column if not exists invite_sent_at timestamptz;

create index if not exists lead_center_customer_idx on public.lead_center(customer_id) where customer_id is not null;
create index if not exists lead_center_quote_idx on public.lead_center(quote_id) where quote_id is not null;
create index if not exists lead_center_invoice_idx on public.lead_center(invoice_id) where invoice_id is not null;

commit;
