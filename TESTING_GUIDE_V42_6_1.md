# Testing Guide — Damasio OS V42.6.1

## 1. Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with your Supabase keys before testing real data.

## 2. Smoke test

Open:

- `/`
- `/login`
- `/admin`
- `/admin/customers`
- `/admin/properties`
- `/admin/routes`
- `/admin/calendar`
- `/employee`
- `/employee/property/demo`
- `/customer`

Expected result: pages should open without blank screens or layout breakage.

## 3. Employee workflow test

Test this exact flow:

1. Open Employee area.
2. Open a property/job.
3. Click Start Job.
4. Confirm status becomes In Progress.
5. Add optional comment.
6. Click Finish Job.
7. Complete the job.
8. Confirm the job is no longer active in the employee route.
9. Confirm the record appears in activity/history.

## 4. Google Maps test

Click Open Google Maps from the job/property workflow.

Expected result: it should open Google Maps using the address, without paid API integration.

## 5. Performance checks

Pay attention to:

- Duplicate loading.
- Pages that flicker.
- Pages that load slowly.
- Customers/Properties reloading every time unnecessarily.
- Calendar or Routes feeling heavy.

## 6. Supabase checks

Confirm:

- Customers load from real database.
- Properties load from real database.
- Jobs/Tasks remain connected.
- Feedback and activity history are preserved.

## 7. Bug report format

Use this format:

```text
Bug:
Page:
Steps:
Expected:
Actual:
Screenshot/video:
Priority: Low / Medium / High
```
