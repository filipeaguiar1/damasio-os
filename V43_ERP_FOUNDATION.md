# Damasio OS V43 — ERP Foundation

## Focus
One integrated ERP foundation. No new isolated modules. Property Service Screen is the center of the system.

## Included
- Property Service Screen with tabs: Overview, Customer, Property, Service, History, Feedback, Tasks, Photos.
- All property operations should open the same customer/property screen.
- Customer and property editing from the same screen.
- Timer Engine guard: old browser sessions are cleared by V43 storage migration.
- Timer can only finish when a valid running manual session exists.
- Reset affects only the selected house and returns it to Open across the system.
- Return Visit reason is stored in Tasks and visible to Admin/Employee.
- Feedback, photos, tasks and history reuse the same Lead/Property record.

## Rule
Customer → Property → Quote → Job → Schedule → Dispatch → Employee Route → Start → Done → Feedback → Task → History.
