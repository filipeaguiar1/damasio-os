# Damasio OS V42.8 — Core Integration

Focus: ERP integration and bug reduction. No new modules.

## Fixed
- Return tasks no longer auto-finish a running house timer.
- House status `Done` is controlled by the Employee `Finish` action, not by task resolution.
- Quick route completion now uses the same service-session finish path instead of a separate completion path.

## Improved filters
- Replaced generic filters with practical filters that reduce search time.
- Customers: missing phone, missing email, gate/access info, notes.
- Properties: missing access notes, gate/access, large lots, notes.
- Schedule/Dispatch: ready to assign, missing date, already assigned, current crew, done.
- All screens continue using the shared `CompactFilter` component.

## Integration rules preserved
- Customer → Property → Quote → Job → Schedule → Dispatch → Employee Route → Start → Done → Feedback → Task → History.
- No layout redesign.
- No new modules.
- Priority remains one unified operational data flow.
