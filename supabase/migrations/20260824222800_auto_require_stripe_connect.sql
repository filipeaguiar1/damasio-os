create or replace function public.require_stripe_connect_when_started()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stripe_connected_account_id is not null
     or coalesce(new.stripe_connect_status,'not_started') <> 'not_started'
  then
    new.stripe_connect_required := true;
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_require_stripe_connect_when_started on public.organizations;
create trigger organizations_require_stripe_connect_when_started
before insert or update of stripe_connected_account_id, stripe_connect_status
on public.organizations
for each row
execute function public.require_stripe_connect_when_started();
