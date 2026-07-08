# Damasio OS V42.5.1 — Layout Regression Fix

## Goal
Restore the visual layout from V42.3 for admin operational screens while preserving all database foundation work added through V42.5.

## Fixed
- Restored `/admin/routes` layout from V42.3.
- Restored `/admin/calendar` layout from V42.3.
- Preserved Customer Portal + Feedback pages from V42.5.
- Preserved Supabase RPC files through `09_customer_portal_rpc.sql`.
- Preserved database repositories/services added in V42.4 and V42.5.

## Preserved database structure
- Customers + Properties RPC
- Operations RPC
- Quotes Workflow RPC
- Scheduling Dispatch RPC
- Customer Portal RPC
- Health Check
- Supabase repository/service architecture

## Rule reinforced
Database integration must not change existing UX unless explicitly requested.
