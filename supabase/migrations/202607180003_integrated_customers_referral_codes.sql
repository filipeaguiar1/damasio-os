-- Company referral codes used by the public quote flow.
begin;

alter table public.organizations add column if not exists referral_code text;

create or replace function public.generate_company_referral_code()
returns text language plpgsql volatile set search_path=public as $$
declare v_alphabet constant text:='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';v_code text;v_i integer;
begin
  loop
    v_code:='';
    for v_i in 1..6 loop v_code:=v_code||substr(v_alphabet,1+floor(random()*length(v_alphabet))::integer,1);end loop;
    exit when not exists(select 1 from organizations where referral_code=v_code);
  end loop;
  return v_code;
end $$;

create or replace function public.set_company_referral_code()
returns trigger language plpgsql set search_path=public as $$
begin
  if nullif(trim(coalesce(new.referral_code,'')),'') is null then new.referral_code:=public.generate_company_referral_code();
  else new.referral_code:=upper(trim(new.referral_code));end if;
  return new;
end $$;

drop trigger if exists organizations_referral_code_default on public.organizations;
create trigger organizations_referral_code_default before insert or update of referral_code on public.organizations
for each row execute function public.set_company_referral_code();

do $$ declare v_id uuid;begin
  for v_id in select id from organizations where referral_code is null loop
    update organizations set referral_code=public.generate_company_referral_code() where id=v_id;
  end loop;
end $$;

alter table public.organizations alter column referral_code set not null;
create unique index if not exists organizations_referral_code_unique on public.organizations(referral_code);
alter table public.organizations drop constraint if exists organizations_referral_code_format;
alter table public.organizations add constraint organizations_referral_code_format check(referral_code~'^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$');

commit;
