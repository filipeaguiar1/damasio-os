# Damasio OS V42.1 — Customers + Properties Database Integration

## Scope
- Customers page now reads from Supabase.
- Properties page now reads from Supabase.
- Add Client now saves Customer + Property to Supabase.
- UI follows: UI → Hook → Service → Repository → Supabase.
- Mock data was removed from Customers and Properties pages.

## Required Supabase step
Run this file in Supabase SQL Editor after the previous database setup:

```text
supabase/05_customer_property_rpc.sql
```

This creates the controlled V42.1 RPC bridge used before full Auth/RLS is finalized.

## Files added
- lib/repositories/customerPropertyRepository.ts
- lib/services/customerPropertyService.ts
- lib/hooks/useCustomerProperties.ts
- supabase/05_customer_property_rpc.sql

## Files updated
- app/admin/customers/page.tsx
- app/admin/properties/page.tsx
- app/admin/add-client/page.tsx
- lib/supabase/database.types.ts
- package.json
