import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const contract = read("lib/simulator/advancedSimulation.ts");
const data = read("lib/simulator/advancedSimulationData.ts");
const runs = read("lib/simulator/advancedSimulationRuns.ts");
const api = read("app/api/admin/operational-simulator/v2/route.ts");
const v1Api = read("app/api/admin/operational-simulator/route.ts");
const v1VisitCleanup = read("app/api/admin/operational-simulator/cleanup-visits/route.ts");
const migration = read("supabase/migrations/202608080100_advanced_operational_simulation_namespace.sql");
const routeCleanup = read("supabase/migrations/202608100120_advanced_simulation_route_cleanup.sql");
const exactPurge = read("supabase/migrations/202608100210_operational_simulation_exact_purge.sql");

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

expect(/large_12_month:[\s\S]*horizonWeeks:\s*52/.test(contract), "large scenario must span a 52-week calendar horizon");
expect(/large_12_month:[\s\S]*customerCount:\s*100/.test(contract), "large scenario must contain 100 customers");
expect(/large_12_month:[\s\S]*employeeCount:\s*10/.test(contract), "large scenario must contain 10 employees");
expect(/large_12_month:[\s\S]*completedWeeks:\s*46/.test(contract), "large scenario must contain 46 active service weeks");
expect(/large_12_month:[\s\S]*expectedCompletedVisits:\s*4600/.test(contract), "large scenario must reconcile 4,600 completed Visits");
expect(/large_12_month:[\s\S]*expectedLiveVisits:\s*20/.test(contract), "large scenario must expose 20 live Visits");
expect(/large_12_month:[\s\S]*expectedServiceRecords:\s*4620/.test(contract), "large scenario must total 4,620 service records");
expect(contract.includes("ops-sim-v2-${companyToken}-${namespace}-"), "simulator accounts must be namespaced by company + namespace");
expect(contract.includes("${companyId}/operational-simulation/${namespace}"), "simulation storage must be namespaced");

expect(data.includes('service.rpc("apply_canonical_route_order_v2_service"'), "all generated route order must use the canonical route writer");
expect(!/from\(["']route_stops["']\)\.insert/.test(data), "simulator must not insert route_stops directly");
expect(data.includes('service.rpc("cleanup_operational_simulation_routes"'), "V2 reset must use the protected Route cleanup RPC");
expect(!/from\(["']routes["']\)\.delete\(/.test(data), "V2 reset must not delete Routes directly");
expect(data.includes('from("payments").select'), "reconciliation must inspect the protected payments ledger");
expect(!/insertRows(?:WithFallback)?\(service,\s*["']payments["']/.test(data), "simulator must not forge provider-confirmed payment rows");
expect(data.includes("ADVANCED_SIMULATION_KM_PER_COMPLETED_VISIT"), "km reconciliation assumption must be explicit");
expect(data.includes("completedDurationSeconds"), "payroll reconciliation must derive from completed Visit duration");
expect(data.includes("scope.emailLikePattern"), "status/reset must be namespace-scoped");
expect(data.includes("scope.storagePrefix"), "photo evidence must be namespace-scoped");

expect(runs.includes('service.rpc("begin_operational_simulation_run"'), "run creation must acquire the namespace atomically in the database");
expect(runs.includes('service.rpc("begin_operational_simulation_reset"'), "reset must acquire the namespace atomically in the database");
expect(runs.includes('status: "ready"'), "run lifecycle must persist ready state");
expect(runs.includes('status: "failed"'), "run lifecycle must persist failed state");
expect(runs.includes('status: "removed"'), "run lifecycle must persist removed state");

expect(api.includes('"create" | "reset" | "remove" | "reconcile"'), "V2 API must expose create/reset/remove/reconcile actions");
expect(api.includes('profile.data.role !== "admin"'), "V2 API must remain restricted to active company Admins");
expect(v1Api.includes('profile.data.role !== "admin"'), "V1 API must remain restricted to active company Admins");
expect(v1VisitCleanup.includes('profile.data.role !== "admin"'), "V1 Visit cleanup must remain restricted to active company Admins");
expect(api.includes("beginAdvancedSimulationRun"), "V2 create must acquire a namespaced run lifecycle");
expect(api.includes("beginAdvancedSimulationReset"), "V2 reset must acquire a namespaced reset lifecycle");
expect(api.includes("!transition.acquired && !transition.alreadyRemoved"), "V2 reset must reject concurrent cleanup ownership");
expect(api.includes("reconcileAdvancedSimulation"), "V2 API must run reconciliation");
expect(api.includes("removeAdvancedSimulationData"), "V2 create failure must have cleanup support");

expect(migration.includes("unique (company_id, namespace)"), "database must enforce one registry row per company + namespace");
expect(migration.includes("enable row level security"), "simulation registry must have RLS enabled");
expect(migration.includes("to service_role"), "simulation registry/cleanup must remain service-role only");
expect(migration.includes("begin_operational_simulation_run"), "database must expose atomic create acquisition");
expect(migration.includes("begin_operational_simulation_reset"), "database must expose atomic reset acquisition");
expect(migration.includes("existing.status in ('failed', 'removed')"), "atomic create may only reuse failed or removed namespaces");
expect(migration.includes("for update"), "atomic reset must lock the namespace registry row");
expect(migration.includes("ops-sim-v2-"), "Visit cleanup guard must recognize V2 namespaced simulator Customers");
expect(migration.includes("cleanup_operational_simulation_visits"), "protected Visit cleanup RPC must remain present");
expect(routeCleanup.includes("char_length(v_namespace) > 32"), "Route cleanup must enforce the same namespace length contract as the API");
expect(routeCleanup.includes("from authenticated"), "Route cleanup RPC must not be executable by authenticated browser sessions");
expect(routeCleanup.includes("to service_role"), "Route cleanup RPC must remain service-role only");
expect(exactPurge.includes("purge_operational_simulation_v1_run"), "V1 QA must have an exact run-scoped hard purge");
expect(exactPurge.includes("purge_operational_simulation_v2_namespace"), "V2 QA must have an exact namespace-scoped hard purge");
expect(exactPurge.includes("refused a Route shared with non-simulation Visits"), "hard purge must refuse shared Routes");
expect(exactPurge.includes("to service_role"), "hard purge entry points must remain service-role only");

if (failures.length) {
  console.error("Advanced Simulation validation failed:");
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log("Advanced Simulation validation passed.");
