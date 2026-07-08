# Damasio OS V43.0.3 — Task Assignment Lock

## Included

- Return Visit tasks now have a safer lifecycle:
  - Open
  - Assigned
  - In Progress
  - Completed
  - Resolved
- Assign now requires confirmation before sending the task to an employee.
- Once assigned, the worker/date are locked.
- Assigned tasks cannot be assigned to another employee.
- New Unassign flow returns the task to Open.
- Unassign requires confirmation.
- Resolve requires confirmation and is only available after the employee completes the task.
- Existing old tasks assigned to workers are normalized as Assigned when loaded.
- Activity History receives assign, unassign and resolve actions.

## Important rule

A task can only be reassigned after Admin clicks Unassign.
