import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log("SKIP retired York cleanup: Supabase service environment is unavailable");
  process.exit(0);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function exactYork(value) {
  const address = String(value || "").trim().toLowerCase().replace(/\./g, "");
  return address === "55 york blvd" || address === "55 york boulevard";
}

function isDemoCustomer(customer) {
  return /^demo customer\b/i.test(String(customer?.full_name || ""))
    || /@4everseasons\.test$/i.test(String(customer?.email || ""))
    || /\[TEMP_DEMO_SANDBOX_V1\]/i.test(String(customer?.notes || ""));
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function projection(visits) {
  return [...visits]
    .sort((left, right) =>
      Number(left.route_order ?? 9999) - Number(right.route_order ?? 9999)
      || String(left.created_at || "").localeCompare(String(right.created_at || ""))
      || String(left.id).localeCompare(String(right.id)))
    .map(visit => String(visit.id));
}

async function must(query, label) {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const candidateProperties = await must(
  supabase.from("properties").select("id,customer_id,address_line1").ilike("address_line1", "55 York%"),
  "load York properties",
);
const yorkProperties = (candidateProperties || []).filter(property => exactYork(property.address_line1));

if (!yorkProperties.length) {
  console.log("PASS retired York cleanup: no matching property exists");
  process.exit(0);
}

const customerIds = unique(yorkProperties.map(property => property.customer_id));
const customers = customerIds.length
  ? await must(
      supabase.from("customers").select("id,full_name,email,notes").in("id", customerIds),
      "load York customers",
    )
  : [];
const demoCustomerIds = new Set((customers || []).filter(isDemoCustomer).map(customer => String(customer.id)));
const propertyIds = yorkProperties
  .filter(property => demoCustomerIds.has(String(property.customer_id)))
  .map(property => String(property.id));

if (!propertyIds.length) {
  console.log("PASS retired York cleanup: York properties are not temporary demo data");
  process.exit(0);
}

const targetVisits = await must(
  supabase
    .from("visits")
    .select("id,route_id,job_id,customer_id,property_id,status,route_order,company_id,organization_id,created_at")
    .in("property_id", propertyIds)
    .neq("status", "cancelled"),
  "load retired York visits",
);

assert.equal(
  (targetVisits || []).some(visit => String(visit.status) === "in_progress"),
  false,
  "The retired 55 York demo visit is currently in progress and cannot be cleaned safely.",
);

let removed = 0;
for (const routeId of unique((targetVisits || []).map(visit => visit.route_id))) {
  const routeVisits = await must(
    supabase
      .from("visits")
      .select("id,property_id,status,route_order,company_id,organization_id,created_at")
      .eq("route_id", routeId)
      .neq("status", "cancelled")
      .order("route_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    `load route ${routeId}`,
  );
  const targets = (routeVisits || []).filter(visit => propertyIds.includes(String(visit.property_id)));
  if (!targets.length) continue;

  const targetIds = new Set(targets.map(visit => String(visit.id)));
  const remaining = (routeVisits || []).filter(visit => !targetIds.has(String(visit.id)));
  const remainingIds = new Set(remaining.map(visit => String(visit.id)));
  const companyId = String(routeVisits?.[0]?.company_id || routeVisits?.[0]?.organization_id || "");
  assert.ok(companyId, `Route ${routeId} is missing its company ID.`);

  const routeStops = await must(
    supabase.from("route_stops").select("visit_id,position").eq("route_id", routeId).order("position"),
    `load route stops ${routeId}`,
  );
  const storedOrder = (routeStops || [])
    .map(stop => String(stop.visit_id))
    .filter(visitId => remainingIds.has(visitId));
  const order = storedOrder.length === remaining.length ? storedOrder : projection(remaining);

  await must(supabase.from("route_stops").delete().eq("route_id", routeId), `clear route stops ${routeId}`);
  await must(
    supabase.from("visits").update({
      status: "cancelled",
      route_id: null,
      route_order: null,
      crew_id: null,
      assigned_employee_id: null,
      started_at: null,
      finished_at: null,
      duration_seconds: null,
    }).in("id", [...targetIds]),
    `cancel retired York visits ${routeId}`,
  );
  await must(
    supabase.from("visits").update({ route_order: null }).eq("route_id", routeId).neq("status", "cancelled"),
    `clear route order ${routeId}`,
  );

  if (order.length) {
    await must(
      supabase.from("route_stops").insert(order.map((visitId, index) => ({
        company_id: companyId,
        route_id: routeId,
        visit_id: visitId,
        position: index + 1,
        updated_at: new Date().toISOString(),
      }))),
      `write route stops ${routeId}`,
    );
  }

  for (let index = 0; index < order.length; index += 1) {
    await must(
      supabase.from("visits").update({ route_order: index + 1 }).eq("id", order[index]).eq("route_id", routeId),
      `project route order ${routeId}:${index + 1}`,
    );
  }

  const state = await must(
    supabase.from("route_order_state").select("version").eq("route_id", routeId).maybeSingle(),
    `load route version ${routeId}`,
  );
  const nextVersion = Number(state?.version || 1) + 1;
  await must(
    supabase.from("route_order_state").upsert({
      route_id: routeId,
      company_id: companyId,
      version: nextVersion,
      last_source: "one_time_remove_retired_demo_york",
      last_actor_profile_id: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "route_id" }),
    `write route version ${routeId}`,
  );
  await must(
    supabase.from("employee_smart_route_state").update({
      original_order: order,
      applied_order: order,
      active: false,
      restored_at: new Date().toISOString(),
      restored_by_profile_id: null,
      route_version: nextVersion,
      updated_at: new Date().toISOString(),
    }).eq("route_id", routeId),
    `reset Smart Route state ${routeId}`,
  );

  const verifiedStops = await must(
    supabase.from("route_stops").select("visit_id,position").eq("route_id", routeId).order("position"),
    `verify route stops ${routeId}`,
  );
  const verifiedVisits = await must(
    supabase.from("visits").select("id,route_order").eq("route_id", routeId).neq("status", "cancelled").order("route_order"),
    `verify visit projection ${routeId}`,
  );
  assert.deepEqual((verifiedStops || []).map(row => String(row.visit_id)), order);
  assert.deepEqual((verifiedVisits || []).map(row => String(row.id)), order);
  removed += targets.length;
}

const targetJobIds = unique((targetVisits || []).map(visit => visit.job_id));
if (targetJobIds.length) {
  await must(supabase.from("jobs").update({ active: false }).in("id", targetJobIds), "deactivate York demo jobs");
}
if (demoCustomerIds.size) {
  await must(
    supabase.from("customers").update({ archived_at: new Date().toISOString() }).in("id", [...demoCustomerIds]),
    "archive York demo customers",
  );
}

const remainingVisits = await must(
  supabase.from("visits").select("id").in("property_id", propertyIds).neq("status", "cancelled"),
  "verify retired York removal",
);
assert.equal((remainingVisits || []).length, 0, "Retired 55 York demo visits still exist in an active route.");

console.log(`PASS retired York cleanup: removed ${removed} active visit(s) and verified canonical order`);
