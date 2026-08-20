create or replace function public.auto_retire_isolated_qa_organization()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.deleted_at is null
     and old.active is true
     and new.active is false
     and coalesce(new.slug, old.slug, '') ~ '^qa-(smart-route|ecosystem|stripe|tenant-a|tenant-b|business-lifecycle)-' then
    new.deleted_at := coalesce(new.deleted_at, now());
    new.purge_after := coalesce(new.purge_after, now());
    new.deletion_reason := coalesce(new.deletion_reason, 'Automatic QA simulation cleanup');
  end if;
  return new;
end;
$$;

drop trigger if exists auto_retire_isolated_qa_organization on public.organizations;
create trigger auto_retire_isolated_qa_organization
before update of active on public.organizations
for each row
execute function public.auto_retire_isolated_qa_organization();

revoke all on function public.auto_retire_isolated_qa_organization() from public, anon, authenticated;
