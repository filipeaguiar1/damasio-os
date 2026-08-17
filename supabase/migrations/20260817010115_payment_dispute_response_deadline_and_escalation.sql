alter table public.service_requests add column if not exists response_due_at timestamptz;
alter table public.service_requests add column if not exists company_response text;
alter table public.service_requests add column if not exists company_responded_at timestamptz;
alter table public.service_requests add column if not exists customer_decision text;
alter table public.service_requests add column if not exists customer_decision_at timestamptz;
alter table public.service_requests add column if not exists master_resolution text;
alter table public.service_requests add column if not exists master_reviewed_at timestamptz;
alter table public.service_requests add column if not exists updated_at timestamptz not null default now();

update public.service_requests
set response_due_at = created_at + interval '3 days'
where request_type = 'payment_dispute' and response_due_at is null;

drop index if exists public.service_requests_one_open_payment_dispute_idx;
create unique index service_requests_one_open_payment_dispute_idx
on public.service_requests(customer_id,payment_id)
where request_type='payment_dispute' and status in ('pending','open','investigating','company_responded','escalated','overdue');

create or replace function public.open_customer_payment_dispute_protected(
  p_customer_id uuid,
  p_company_id uuid,
  p_visit_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_reason text := trim(coalesce(p_reason,''));
  v_visit public.visits%rowtype;
  v_invoice public.invoices%rowtype;
  v_payment public.payments%rowtype;
  v_payout public.company_payout_items%rowtype;
  v_request_id uuid;
  v_existing public.service_requests%rowtype;
  v_support_email text;
  v_payout_held boolean := false;
  v_due timestamptz := now() + interval '3 days';
begin
  if length(v_reason) < 5 then raise exception 'Please explain the payment issue in at least 5 characters.'; end if;
  select * into v_visit from public.visits where id=p_visit_id and customer_id=p_customer_id and coalesce(company_id,organization_id)=p_company_id and status::text='completed' limit 1;
  if not found then raise exception 'Completed Visit was not found for this Customer.'; end if;
  select * into v_invoice from public.invoices where visit_id=v_visit.id and customer_id=p_customer_id and coalesce(company_id,organization_id)=p_company_id and status::text='paid' order by created_at desc limit 1;
  if not found then raise exception 'No paid invoice is linked to this completed Visit.'; end if;
  select * into v_payment from public.payments where invoice_id=v_invoice.id and customer_id=p_customer_id and coalesce(company_id,organization_id)=p_company_id and status::text='succeeded' order by paid_at desc nulls last,created_at desc limit 1;
  if not found then raise exception 'No successful payment is linked to this invoice.'; end if;
  select * into v_existing from public.service_requests where customer_id=p_customer_id and payment_id=v_payment.id and request_type='payment_dispute' and status in ('pending','open','investigating','company_responded','escalated','overdue') limit 1;
  if found then
    select contact_email into v_support_email from public.organizations where id=p_company_id;
    return jsonb_build_object('saved',true,'duplicate',true,'requestId',v_existing.id,'status',v_existing.status,'responseDueAt',v_existing.response_due_at,'invoiceId',v_invoice.id,'invoiceNumber',v_invoice.invoice_number,'paymentId',v_payment.id,'supportEmail',v_support_email);
  end if;
  insert into public.service_requests(organization_id,company_id,customer_id,property_id,service_name,message,status,request_type,visit_id,invoice_id,payment_id,response_due_at,updated_at)
  values(p_company_id,p_company_id,p_customer_id,v_visit.property_id,'Payment dispute · '||coalesce(v_invoice.invoice_number,v_invoice.id::text),v_reason,'pending','payment_dispute',v_visit.id,v_invoice.id,v_payment.id,v_due,now())
  returning id into v_request_id;
  select * into v_payout from public.company_payout_items where payment_id=v_payment.id and company_id=p_company_id limit 1 for update;
  if found then
    if v_payout.status not in ('transferred','refunded','chargeback_reversed') then
      update public.company_payout_items set status='disputed',hold_reason='Customer payment dispute open · request '||v_request_id::text,updated_at=now() where id=v_payout.id;
      v_payout_held := true;
    else
      update public.company_payout_items set hold_reason='Customer payment dispute opened after payout/reversal · request '||v_request_id::text,updated_at=now() where id=v_payout.id;
    end if;
  end if;
  select contact_email into v_support_email from public.organizations where id=p_company_id;
  return jsonb_build_object('saved',true,'duplicate',false,'requestId',v_request_id,'visitId',v_visit.id,'invoiceId',v_invoice.id,'invoiceNumber',v_invoice.invoice_number,'paymentId',v_payment.id,'amount',v_payment.amount,'payoutHeld',v_payout_held,'status','pending','responseDueAt',v_due,'supportEmail',v_support_email);
end;
$$;

revoke all on function public.open_customer_payment_dispute_protected(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.open_customer_payment_dispute_protected(uuid,uuid,uuid,text) to service_role;
