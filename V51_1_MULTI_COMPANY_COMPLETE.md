# V51.1 — Multi Company Complete

This release combines the four planned V51 stabilization sprints:

- tenant migration and restrictive RLS;
- Company → ERP integration foundation;
- audit, health check and company dashboard;
- final architecture rules and V52 Finance preparation.

## Database
Run migrations in order through `202607120003_v51_1_multi_company_complete.sql`.

## Important
The visible Master demo entry remains enabled temporarily for development. Remove it before production launch and use authenticated `role = master` only.
