# Damasio OS Database Blueprint v1

Version: V42.0.1
Status: Foundation blueprint
Principle: Property is the center of the system.

## Product rule

Damasio OS is a SaaS for Landscaping and Snow Removal. The system should work and the user should confirm. Important actions should happen in a maximum of 3 clicks. The AI suggests; it never decides alone.

## Current sprint boundary

Sprint 1 is Database Foundation only.

Included:
- Supabase environment configuration
- PostgreSQL foundation
- Auth readiness
- Storage bucket readiness
- Repository/service boundary
- Health check
- SQL setup/migration foundation

Not included yet:
- Company onboarding UI
- Stripe/billing
- Real module migration from demo/local data
- Automatic AI actions

## Data ownership model

The current schema keeps an internal `organizations` table for future multi-tenant SaaS isolation, but the product must not expose company onboarding yet. This keeps the database scalable without changing the user experience in V42.

## Core entities

### Organization
Internal tenant boundary for future SaaS. Not exposed in the V42 user experience.

### Profile
Maps Supabase Auth users to an app role.

Roles:
- admin
- employee
- customer

### Customer
Customer contact record. A customer can own one or more properties.

### Property
Main entity of the system.

A property owns or connects to:
- customer
- address
- photos
- notes
- service requests
- quotes
- jobs
- visits
- tasks
- feedback
- invoices
- payments
- activity history

### Employee and Crew
Employees can belong to crews. Employees only see operational work assigned to them or their crew. They must never see finance.

### Service Request
A customer/admin request that can later become a quote, job, task, or visit.

### Quote
Commercial proposal. Admin/customer visible. Employee hidden.

### Invoice and Payment
Finance entities. Admin/customer visible where appropriate. Employee hidden.

### Job
Recurring or one-time service connected to a property.

### Route
Daily operational grouping for visits.

### Visit
Scheduled service execution for a job/property.

### Task
Operational issue or return-visit work item.

### Photo
Property, before/after, issue, and completion photos. Stored in Supabase Storage; metadata stored in PostgreSQL.

### Feedback
Customer rating/comment. Used later for admin employee-performance filtering.

### Activity Log
History of important actions. This becomes the permanent audit/history layer.

## Permission rules

### Admin
Can see and manage everything in their organization.

### Employee
Can see only assigned operational work:
- assigned visits
- assigned tasks
- assigned properties needed to complete work
- own crew information

Employee must never see:
- prices
- invoices
- payments
- e-transfer
- tips
- reports
- customers from other crews/routes
- routes from other crews

### Customer
Can see only their own customer/property history, requests, quotes, invoices, payments, photos, and feedback.

## Storage buckets

- property-photos: public read, authenticated upload
- work-photos: public read, authenticated upload
- task-photos: public read, authenticated upload
- before-after: public read, authenticated upload
- documents: authenticated only

## Repository pattern

No screen should talk directly to Supabase.

Required flow:

UI → Hook → Service → Repository → Supabase

Current foundation:
- `lib/supabase/client.ts`
- `lib/repositories/databaseRepository.ts`
- `lib/services/databaseService.ts`
- `app/admin/database/page.tsx`

Future module pattern:
- `lib/repositories/customerRepository.ts`
- `lib/services/customerService.ts`
- `lib/hooks/useCustomers.ts`

## Migration strategy

Use versioned SQL files instead of manually creating tables in the Supabase dashboard.

Current setup file:
- `supabase/00_run_this_first_database_setup.sql`

Migration copy:
- `supabase/migrations/202607020001_v42_database_foundation.sql`

This lets the project be restored or moved to a new Supabase project later.

## QA rules before every ZIP

- Project compiles
- TypeScript passes
- Main routes still load
- No direct UI-to-database access added
- No employee finance exposure
- Database health check available
- Changelog updated
