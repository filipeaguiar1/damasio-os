# Damasio OS V42.8.1 — Route Reset + Practical Filters Fix

## Changes
- Reset House now affects only the selected house.
- If the house was Done, reset returns it to Open/Booked across storage, Dispatch, Routes and Employee Route.
- Service session is removed only for that house.
- Completion/Done remains only through the Finish button.
- Customer filters are now practical: city, big lawns, high grass, access/gate/dog, missing phone/email and notes.
- Customer list can be grouped by city and ordered by city, lawn size or grass height.
- Dispatch now shows Next Cut instead of only Date.
- Dispatch filters now include Pending Today and Overdue.
- Route Manager label updated from V24 to V42.8.1.
- Routes now include Pending Today filter and clearer pending/overdue language.

## QA
- npm run build: passed.
