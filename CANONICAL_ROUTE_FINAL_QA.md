# Canonical Route Final QA

The canonical Route is persisted atomically in Postgres through the route-order transaction. Admin web, Admin mobile, Employee web and Employee mobile read the same versioned snapshot containing origin, ordered Visit IDs, stop coordinates, statuses and road geometry.

Smart Route previews remain unpublished until the Employee confirms Apply. Applying or restoring a route increments the canonical version and every surface replaces its complete snapshot. Local storage, client-side stop ordering and route-only geometry caches are not authoritative.

Required release validation:

- Admin publishes the daily Route to an Employee.
- All four authenticated route screens show the same houses, markers, order, origin and geometry.
- Employee creates a Smart Route from the chosen starting point and previews it without altering Admin.
- Employee applies the Smart Route; all four screens receive the new version and identical order.
- Admin restores or republishes the order; Employee receives the same version.
- Start and Finish remain canonical Visit actions.
- Retired demo data and duplicate simulation identities do not reappear.
