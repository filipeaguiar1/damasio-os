# Damasio OS V42.5 — Customer Portal + Feedback

## Scope

Customer Portal now reads real Supabase data for the demo customer property.

## Added

- `supabase/09_customer_portal_rpc.sql`
- `lib/repositories/customerPortalRepository.ts`
- `lib/services/customerPortalService.ts`

## Updated customer pages

- `/customer`
- `/customer/next-visit`
- `/customer/history`
- `/customer/tasks`
- `/customer/requests`
- `/customer/feedback`

## Workflow

Customer Portal reads only one customer property in this demo phase.

Customer request:

```txt
Customer → Service Request → Activity History
```

Customer low feedback:

```txt
Customer Feedback rating <= 3 → Task / Return Visit → Activity History
```

## Next

V42.6 should connect Customer Estimates and Invoices to Supabase.
