begin;

alter table public.profiles
  add column if not exists phone text,
  add column if not exists recovery_email text;

comment on column public.profiles.phone is 'Primary phone number supplied during account onboarding.';
comment on column public.profiles.recovery_email is 'Alternative contact email. Supabase password recovery continues to use the authenticated login email.';

commit;
