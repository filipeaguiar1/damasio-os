# Damasio OS V51.0.4 — Multi Company Live Integration

## Working in practice
- Companies show real Admin, Employee and Customer totals.
- A company detail view lists its people and can activate/deactivate the company.
- New company flow creates the company and its first Admin in demo mode.
- Lead Center assigns a lead to a company.
- Company acceptance converts the lead into Customer + Property and records an audit event.
- Temporary access generates a one-time six-digit code with 30-minute expiry.
- Code approval opens the selected company context and records an audit event.
- Three access levels and System / Email / Both delivery options remain available.

## Database migration
Run `supabase/migrations/202607120002_v51_multi_company_live_integration.sql` after the V51.0 foundation migration.

The migration adds canonical `company_id` fields while preserving `organization_id` for compatibility, and adds the atomic `master_convert_lead_to_customer` function.
