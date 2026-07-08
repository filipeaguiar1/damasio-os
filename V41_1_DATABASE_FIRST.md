# Damasio OS V41.1 — Database First Fix

This version removes the company signup/onboarding flow for now.

## Why
The previous version introduced company signup too early. The priority now is to keep the app simple, stable and functional while the Supabase database is connected step by step.

## What changed
- Removed visible **Create Company** action from the header.
- Login page now keeps Demo Admin, Demo Employee and Demo Customer.
- `/signup` no longer creates a company; it redirects the user back to Login/Database Setup.
- Database setup screen now focuses only on Supabase schema, RLS and seed data.
- Auth onboarding is paused until the database foundation is stable.

## Current focus
1. Supabase project
2. SQL schema
3. RLS policies
4. Seed demo data
5. Then real login/users
