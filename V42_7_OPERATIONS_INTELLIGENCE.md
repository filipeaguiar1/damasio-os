# Damasio OS V42.7 — Operations Intelligence

Base: V42.6.1 Testing Build

## Goal

V42.7 adds a lightweight workflow engine and an operations intelligence layer while preserving the approved V42.5.1/V42.6 layout.

## Implemented

### 1. Workflow Engine

Added `lib/workflow/workflowEngine.ts` with lifecycle stages:

- lead
- quote
- approved
- scheduled
- assigned
- in_progress
- completed
- feedback
- task
- archived

The engine maps operational state into a single workflow snapshot and provides consistent labels/next actions.

### 2. Local Workflow Events

Added local workflow event storage in `lib/storage.ts`:

- `getWorkflowEvents()`
- `addWorkflowEvent()`
- `getLeadWorkflowSnapshot()`
- `getUnifiedVisitHistory()`
- `getOperationsIntelligence()`

Workflow events are automatically recorded for:

- employee Start Job
- employee Finish Job
- customer feedback
- customer reported task
- resolved return task

### 3. Employee Route Refinement

The employee route keeps the same layout and simple workflow.

Added a small workflow row inside the existing property details table:

- current workflow label
- next action

No heavy map integration was added. Google Maps remains a simple external link.

### 4. Admin Workflow Page

Added `/admin/workflow`.

This page shows:

- active jobs
- completed visits
- open tasks
- feedback count
- unified visit history
- workflow events

The page uses existing card/table styling to avoid visual regression.

### 5. Dashboard Operations Intelligence

The Admin dashboard now includes a second metrics row for:

- active jobs
- completed visits
- open tasks
- workflow engine stages

### 6. Supabase Workflow SQL

Added `supabase/11_workflow_engine.sql`.

Includes:

- `workflow_events` table
- indexes for org/date, entity and stage
- demo RLS policy
- `record_workflow_event()` helper RPC

## Preserved

- Approved layout
- Employee simplicity
- Start / Finish flow
- Optional comments only
- External Google Maps link only
- Existing Supabase architecture
- Existing Repository/Service pattern

## Files Added

- `lib/workflow/workflowEngine.ts`
- `app/admin/workflow/page.tsx`
- `supabase/11_workflow_engine.sql`
- `V42_7_OPERATIONS_INTELLIGENCE.md`
- `QA_REPORT_V42_7.md`

## Files Updated

- `lib/storage.ts`
- `app/employee/route/page.tsx`
- `app/admin/page.tsx`
- `components/admin/AdminShell.tsx`
- `package.json`

## Notes

This version is intentionally conservative. It prepares the system for deeper automation later, but it does not overload employees with extra buttons or complex steps.
