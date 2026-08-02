import fs from "node:fs";

const sql = fs.readFileSync(
  "supabase/migrations/202608020490_canonical_route_preflight_v2.sql",
  "utf8",
);

const required = [
  "table public.employee_smart_route_state",
  "column visits.route_order",
  "column employee_smart_route_state.restored_at",
  "column employee_smart_route_state.restored_by_profile_id",
  "column activity_log.metadata",
  "function master_has_company_access(uuid,text)",
  "function employee_can_use_route(uuid)",
  "function publish_canonical_route_daily(uuid,uuid,date,uuid[],uuid[])",
  "function move_canonical_visits(uuid[],uuid,uuid,text)",
  "constraint visits_route_order_unique",
  "DEFERRABLE INITIALLY DEFERRED",
  "Canonical Route Stops V2 preflight failed",
];

const missing = required.filter(value => !sql.includes(value));
if (missing.length) {
  console.error("Route Stops V2 preflight validation failed:");
  for (const value of missing) console.error(`- missing coverage: ${value}`);
  process.exit(1);
}

if (!sql.trimStart().startsWith("begin;")) {
  console.error("Route Stops V2 preflight must run in a transaction.");
  process.exit(1);
}
if (!sql.trimEnd().endsWith("commit;")) {
  console.error("Route Stops V2 preflight must end explicitly.");
  process.exit(1);
}

console.log("Route Stops V2 schema preflight coverage passed.");
