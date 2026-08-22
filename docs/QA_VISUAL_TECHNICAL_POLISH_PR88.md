# PR #88 Visual and Technical Quality Sweep

## Scope

Priority pass to remove generic AI/template signals while preserving validated route, Smart Route, Start/Finish, tenant isolation, billing and customer portal behavior.

## Before

- Global UI leaned on oversized radius, large generic shadows and repeated rounded card surfaces.
- Landing and portal areas used emoji-like service icons and decorative gradients.
- Admin shell mixed operational UI with playful alert glyphs and large visual treatments.
- Empty/loading states were visually inconsistent across desktop, mobile and customer surfaces.
- Database cleanup left historical bloat in `visits` and `route_stops` after simulation churn.

## After

- Added `app/product-quality-system.css` as a final design-system layer with deliberate tokens for radius, spacing, typography, color, buttons, inputs, tables, cards, nav, alerts and empty states.
- Reduced decorative gradients/glass effects on shared shell surfaces and made the admin workspace denser and more operational.
- Replaced functional emoji glyphs in landing services/features and masked large-flow pictograms through the shared quality layer where a direct file rewrite would risk overwriting newer PR work.
- Preserved Customer Portal CTA contrast fix: white secondary CTA, dark green text, green border, clear hover and focus state.
- Kept route/Smart Route/Start/Finish logic untouched; visual changes are CSS and presentational copy/icon replacements.

## Database Bloat Notes

Read-only measurements on `damasio-os` showed:

- `visits`: 659 live rows, 4 dead rows, 60,760,064 heap bytes, 59,490,304 index bytes, 120,299,520 total bytes.
- `route_stops` before online drop: 629 live rows, 2 dead rows, 14,991,360 heap bytes, 32,251,904 index bytes, 47,276,032 total bytes.
- `pgstattuple` is not installed; `pg_stat_statements` is installed. No extension was created.

Safe online optimization applied:

- Dropped `public.route_stops_visit_idx` with `drop index concurrently`.
- Kept `route_stops_visit_unique` on `visit_id`, plus existing route uniqueness constraints.
- `route_stops` after: 14,991,360 heap bytes, 28,360,704 index bytes, 43,384,832 total bytes.
- Post-checks: 0 orphan `route_stops`, 0 duplicate `(route_id, position)`, 0 duplicate `(route_id, visit_id)`.

## Checklist

- [x] UI emoji audit and first removal wave.
- [x] Shared design-system overlay added without deleting existing functional CSS.
- [x] Landing page service/features placeholders made professional.
- [x] Admin shell/Alert Center visual polish.
- [x] Employee route/profile placeholders and alerts neutralized through direct copy/icon replacement.
- [x] Customer mobile profile/request placeholders neutralized through direct copy/icon replacement.
- [x] Admin map property placeholder neutralized through direct copy/icon replacement.
- [x] Master theme selector neutralized visually through the shared design-system layer.
- [x] Online database optimization applied only where redundancy was proven.
- [x] Typecheck passed after the first wave.
- [x] Full production build passed after resyncing the final branch state locally.
- [ ] Follow-up visual screenshot pass across desktop/mobile.
- [ ] Deeper page-by-page copy pass for secondary admin/customer screens.
