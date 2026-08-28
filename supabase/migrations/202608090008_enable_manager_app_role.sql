-- Manager exists throughout the application authorization model, but the
-- database enum historically omitted it. Add the value without changing any
-- existing profile.

alter type public.app_role add value if not exists 'manager' after 'admin';
