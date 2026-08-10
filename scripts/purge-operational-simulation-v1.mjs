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

let companyId = "";
const profile = await service
  .from("profiles")
  .select("company_id,organization_id")
  .ilike("email", workerEmail)
  .limit(1)
  .maybeSingle();
if (profile.error) throw new Error(`V1 simulator purge profile lookup: ${profile.error.message}`);
companyId = String(profile.data?.company_id || profile.data?.organization_id || "");

if (!companyId) {
  const customer = await service
    .from("customers")
    .select("company_id,organization_id")
    .ilike("email", `ops-sim-${match[1]}-${runId}-customer-%@4everseasons.test`)
    .limit(1)
    .maybeSingle();
  if (customer.error) throw new Error(`V1 simulator purge Customer lookup: ${customer.error.message}`);
  companyId = String(customer.data?.company_id || customer.data?.organization_id || "");
}

if (!companyId || !companyId.toLowerCase().startsWith(match[1].toLowerCase())) {
  throw new Error("V1 simulator purge could not prove the company/run boundary.");
}

const purge = await service.rpc("purge_operational_simulation_v1_run", {
  p_company_id: companyId,
  p_run_id: runId,
});
if (purge.error) throw new Error(`V1 simulator purge RPC: ${purge.error.message}`);

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
  customerCount: Number(purge.data?.customerCount || 0),
  visitCount: Number(purge.data?.visitCount || 0),
  authRemoved,
}));
