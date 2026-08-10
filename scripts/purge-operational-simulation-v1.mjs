import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const handoffPath = process.argv[2] || "/tmp/damasio-operational-simulator-handoff.json";
if (!existsSync(handoffPath)) {
  console.log("V1 simulator purge skipped: no handoff fixture exists.");
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("V1 simulator purge requires Supabase service-role configuration.");

const handoff = JSON.parse(readFileSync(handoffPath, "utf8"));
const workerEmail = String(handoff.workerEmail || "").trim().toLowerCase();
const match = workerEmail.match(/^ops-sim-([0-9a-f]{8})-([a-z0-9]+)-worker-\d+@4everseasons\.test$/i);
if (!match) throw new Error(`V1 simulator purge refused an unexpected worker marker: ${workerEmail || "missing"}`);

const runId = match[2].toLowerCase();
const service = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function companyFilter(companyId) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function chunks(rows, size) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

async function cleanupVisitBatch(companyId, customerIds) {
  const cleanup = await service.rpc("cleanup_operational_simulation_visits", {
    p_company_id: companyId,
    p_customer_ids: customerIds,
  });
  if (!cleanup.error) return Number(cleanup.data?.visitCount || 0);

  const message = String(cleanup.error.message || "");
  if (/statement timeout|canceling statement/i.test(message) && customerIds.length > 1) {
    const midpoint = Math.ceil(customerIds.length / 2);
    const left = await cleanupVisitBatch(companyId, customerIds.slice(0, midpoint));
    const right = await cleanupVisitBatch(companyId, customerIds.slice(midpoint));
    return left + right;
  }
  throw new Error(`V1 simulator Visit cleanup: ${message || "cleanup failed"}`);
}

let companyId = "";
const profile = await service
  .from("profiles")
  .select("company_id,organization_id")
  .ilike("email", workerEmail)
  .limit(1)
  .maybeSingle();
if (profile.error) throw new Error(`V1 simulator purge profile lookup: ${profile.error.message}`);
companyId = String(profile.data?.company_id || profile.data?.organization_id || "");

const exactCustomerPattern = `ops-sim-${match[1]}-${runId}-customer-%@4everseasons.test`;
if (!companyId) {
  const customer = await service
    .from("customers")
    .select("company_id,organization_id")
    .ilike("email", exactCustomerPattern)
    .limit(1)
    .maybeSingle();
  if (customer.error) throw new Error(`V1 simulator purge Customer lookup: ${customer.error.message}`);
  companyId = String(customer.data?.company_id || customer.data?.organization_id || "");
}

if (!companyId || !companyId.toLowerCase().startsWith(match[1].toLowerCase())) {
  throw new Error("V1 simulator purge could not prove the company/run boundary.");
}

const customers = await service
  .from("customers")
  .select("id")
  .or(companyFilter(companyId))
  .ilike("email", exactCustomerPattern);
if (customers.error) throw new Error(`V1 simulator purge Customer inventory: ${customers.error.message}`);
const customerIds = [...new Set((customers.data || []).map(row => String(row.id)).filter(Boolean))];

let visitsRemoved = 0;
for (const batch of chunks(customerIds, 4)) {
  visitsRemoved += await cleanupVisitBatch(companyId, batch);
}

const purge = await service.rpc("finalize_operational_simulation_v1_run", {
  p_company_id: companyId,
  p_run_id: runId,
});
if (purge.error) throw new Error(`V1 simulator final purge RPC: ${purge.error.message}`);

const profileIds = Array.isArray(purge.data?.profileIds) ? purge.data.profileIds.map(String) : [];
let authRemoved = 0;
for (const profileId of profileIds) {
  const deleted = await service.auth.admin.deleteUser(profileId);
  if (deleted.error && !/not found/i.test(deleted.error.message || "")) {
    throw new Error(`V1 simulator auth purge ${profileId}: ${deleted.error.message}`);
  }
  authRemoved += 1;
}

console.log(JSON.stringify({
  purged: true,
  runId,
  customerCount: Number(purge.data?.customerCount || customerIds.length),
  visitCount: Number(purge.data?.visitCount || visitsRemoved),
  visitsRemoved,
  authRemoved,
}));
