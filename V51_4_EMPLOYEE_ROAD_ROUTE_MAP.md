# Damasio OS V51.4 — Employee Road Route Map

## Included
- Employee Mobile now has List / Map views inside the assigned route.
- The map only shows homes assigned by Admin to Crew A.
- Property addresses are geocoded through a server route using Nominatim and cached in the browser.
- Existing saved latitude/longitude values are always preferred.
- The route line is calculated through OSRM and follows drivable streets instead of drawing straight segments.
- Numbered markers keep the same order as the assigned route.
- Marker colors remain integrated with Open, Done, Skipped and Issue states.
- Selecting a marker opens a compact mobile card with Open Visit and Directions.
- No employee GPS or live tracking was added.

## Test-service note
The public Nominatim and OSRM services are used only for this prototype. Their public infrastructure is not intended as the final production backend for a commercial SaaS. Before production launch, configure a contracted provider or host dedicated instances.
