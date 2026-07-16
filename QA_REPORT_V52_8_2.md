# QA Report V52.8.2

## Smart Route preview controls

- Moved the alternate-route action from the map overlay to the preview header.
- Kept the circular refresh animation while another route is calculated.
- Replaced the browser-only tooltip with a touch/click popover.
- Route information displays approximate total distance and driving time only.
- Service time at properties is explicitly excluded.
- The preview map is no longer obscured by floating route controls.

## Validation

- Confirmed JSX structure and matching CSS selectors.
- Package and lockfile were left unchanged.
- Full build must be run locally because dependencies are not installed in this environment.
