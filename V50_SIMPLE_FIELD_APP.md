# Damasio OS V50 — Simple Field App

Focus: simple mobile-first app for Admin, Employee and Customer.

## Included

- `/mobile` landing page with Damasio logo animation and lawn mowing animation.
- `/mobile/employee` simple field app:
  - route of the day;
  - open property service screen;
  - Start / Finish;
  - optional comment;
  - take/upload photo;
  - return visit tasks;
  - completed task leaves employee list and goes to Admin review.
- `/mobile/admin` simple command snapshot:
  - open homes;
  - completed homes;
  - return visits;
  - quick links to full Admin screens.
- `/mobile/customer` simple customer view:
  - service status;
  - next visit;
  - feedback shortcut;
  - link to full portal.
- Manifest updated for PWA install using `/mobile` as the start page.

## Philosophy

This version intentionally avoids adding heavy modules. The goal is to test the real workflow on phones with a clean and beautiful interface.

## Realtime

The mobile app listens to local Damasio sync events and browser storage updates. When Supabase environment variables are configured, it also opens a realtime channel for public database changes and refreshes the mobile views automatically.
