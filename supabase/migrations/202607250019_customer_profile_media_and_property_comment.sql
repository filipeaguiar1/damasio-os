begin;

alter table public.properties
  add column if not exists customer_comment text;

comment on column public.properties.customer_comment is
  'Comment provided by the customer. Address and service specifications remain Admin/Master controlled.';

commit;
