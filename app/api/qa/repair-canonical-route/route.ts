import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const KNOWN_ROUTE_ID = "7ce39ec5-b1c5-4ef8-bf3b-8fd01138e3d4";

function exactYork(value: unknown) {
  const address = String(value || "").trim().toLowerCase().replace(/\./g, "");
  return address === "55 york blvd" || address === "55 york boulevard";
}

function isDemo(customer: any) {
  return /^demo customer\b/i.test(String(customer?.full_name || ""))
    || /@4everseasons\.test$/i.test(String(customer?.email || ""))
    || /\[TEMP_DEMO_SANDBOX_V1\]/i.test(String(customer?.notes || ""));
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)).map(String))];
}

function projectedOrder(visits: any[]) {
  return [...visits]
    .sort((left, right) =>
      Number(left.route_order ?? 9999) - Number(right.route_order ?? 9999)
      || String(left.created_at || "").localeCompare(String(right.created_at || ""))
      || String(left.id).localeCompare(String(right.id)))
    .map(visit => String(visit.id));
}

function pause(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function must<T = any>(promise: PromiseLike<{ data: T; error: any }>, label: string) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function replaceRouteStops(service: any, routeId: string, companyId: string, order: string[]) {
  let lastError = "";
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const removed = await service.from("route_stops").delete().eq("route_id", routeId);
    if (removed.error) throw new Error(`reset route stops ${routeId}: ${removed.error.message}`);
    await pause(attempt * 300);

    if (!order.length) return;
    const inserted = await service.from("route_stops").insert(order.map((visitId: string, index: number) => ({
      company_id: companyId,
      route_id: routeId,
      visit_id: visitId,
      position: index + 1,
      updated_at: new Date().toISOString(),
    })));
    if (!inserted.error) return;

    lastError = inserted.error.message;
    if (!/duplicate key value/i.test(lastError) || attempt === 6) {
      throw new Error(`write canonical stops ${routeId}: ${lastError}`);
    }
    await pause(attempt * 500);
  }
  throw new Error(`write canonical stops ${routeId}: ${lastError || "unknown error"}`);
}

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Preview Supabase service environment is unavailable.");
    const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;

    const properties = await must<any[]>(
      service.from("properties").select("id,customer_id,address_line1").ilike("address_line1", "55 York%"),
      "load York properties",
    );
    const yorkProperties = (properties || []).filter(property => exactYork(property.address_line1));
    const customerIds = unique(yorkProperties.map(property => property.customer_id));
    const customers = customerIds.length
      ? await must<any[]>(service.from("customers").select("id,full_name,email,notes").in("id", customerIds), "load York customers")
      : [];
    const demoCustomerIds = new Set((customers || []).filter(isDemo).map(customer => String(customer.id)));
    const propertyIds = yorkProperties
      .filter(property => demoCustomerIds.has(String(property.customer_id)))
      .map(property => String(property.id));

    const yorkVisits = propertyIds.length
      ? await must<any[]>(
          service.from("visits").select("id,route_id,job_id,customer_id,property_id,status").in("property_id", propertyIds),
          "load York visits",
        )
      : [];
    const yorkVisitIds = unique((yorkVisits || []).map(visit => visit.id));
    const staleStops = yorkVisitIds.length
      ? await must<any[]>(
          service.from("route_stops").select("route_id,visit_id,position").in("visit_id", yorkVisitIds),
          "load stale York route stops",
        )
      : [];
    const affectedRouteIds = unique([
      KNOWN_ROUTE_ID,
      ...(yorkVisits || []).map(visit => visit.route_id),
      ...(staleStops || []).map(stop => stop.route_id),
    ]);

    if (yorkVisitIds.length) {
      const active = (yorkVisits || []).filter(visit => String(visit.status) === "in_progress");
      if (active.length) throw new Error("The retired York demo visit is currently in progress.");
      await must(
        service.from("visits").update({
          status: "cancelled",
          route_id: null,
          route_order: null,
          crew_id: null,
          assigned_employee_id: null,
          started_at: null,
          finished_at: null,
          duration_seconds: null,
        }).in("id", yorkVisitIds),
        "cancel every York demo visit",
      );
      await must(service.from("route_stops").delete().in("visit_id", yorkVisitIds), "remove every York route stop");
    }

    const reports: Array<{ routeId: string; visits: number; stops: number; version: number }> = [];
    for (const routeId of affectedRouteIds) {
      const visits = await must<any[]>(
        service.from("visits")
          .select("id,route_order,company_id,organization_id,created_at,status")
          .eq("route_id", routeId)
          .neq("status", "cancelled")
          .order("route_order", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true }),
        `load active route ${routeId}`,
      );
      if (!visits?.length) continue;

      const activeIds = new Set(visits.map(visit => String(visit.id)));
      const currentStops = await must<any[]>(
        service.from("route_stops").select("visit_id,position").eq("route_id", routeId).order("position"),
        `load route stops ${routeId}`,
      );
      const storedOrder = unique((currentStops || [])
        .map(stop => String(stop.visit_id))
        .filter(visitId => activeIds.has(visitId)));
      const order = storedOrder.length === visits.length ? storedOrder : projectedOrder(visits);
      const companyId = String(visits[0].company_id || visits[0].organization_id || "");
      if (!companyId) throw new Error(`Route ${routeId} is missing its company ID.`);

      await must(
        service.from("visits").update({ route_order: null }).eq("route_id", routeId).neq("status", "cancelled"),
        `reset visit order ${routeId}`,
      );
      await replaceRouteStops(service, routeId, companyId, order);
      for (let index = 0; index < order.length; index += 1) {
        await must(
          service.from("visits").update({ route_order: index + 1 }).eq("route_id", routeId).eq("id", order[index]),
          `write route projection ${routeId}:${index + 1}`,
        );
      }

      const state = await must<any>(
        service.from("route_order_state").select("version").eq("route_id", routeId).maybeSingle(),
        `load route version ${routeId}`,
      );
      const nextVersion = Number(state?.version || 1) + 1;
      await must(
        service.from("route_order_state").upsert({
          route_id: routeId,
          company_id: companyId,
          version: nextVersion,
          last_source: "preview_repair_canonical_route",
          last_actor_profile_id: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "route_id" }),
        `write route version ${routeId}`,
      );
      await must(
        service.from("employee_smart_route_state").update({
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

      const verifiedStops = await must<any[]>(
        service.from("route_stops").select("visit_id,position").eq("route_id", routeId).order("position"),
        `verify stops ${routeId}`,
      );
      const verifiedVisits = await must<any[]>(
        service.from("visits").select("id,route_order").eq("route_id", routeId).neq("status", "cancelled").order("route_order"),
        `verify visits ${routeId}`,
      );
      const stopOrder = (verifiedStops || []).map(row => String(row.visit_id));
      const visitOrder = (verifiedVisits || []).map(row => String(row.id));
      if (stopOrder.join("|") !== order.join("|") || visitOrder.join("|") !== order.join("|")) {
        throw new Error(`Canonical verification failed for route ${routeId}.`);
      }
      reports.push({ routeId, visits: visitOrder.length, stops: stopOrder.length, version: nextVersion });
    }

    const jobIds = unique((yorkVisits || []).map(visit => visit.job_id));
    if (jobIds.length) await must(service.from("jobs").update({ active: false }).in("id", jobIds), "deactivate York jobs");
    if (demoCustomerIds.size) {
      await must(
        service.from("customers").update({ archived_at: new Date().toISOString() }).in("id", [...demoCustomerIds]),
        "archive York customers",
      );
    }

    const remainingYork = propertyIds.length
      ? await must<any[]>(
          service.from("visits").select("id").in("property_id", propertyIds).neq("status", "cancelled"),
          "verify York cleanup",
        )
      : [];
    if (remainingYork.length) throw new Error("Active York demo visits remain after repair.");

    return NextResponse.json({ repaired: true, removedYorkVisits: yorkVisitIds.length, activeYorkVisits: 0, routes: reports });
  } catch (error) {
    console.error("qa-repair-canonical-route", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Canonical route repair failed." },
      { status: 500 },
    );
  }
}
