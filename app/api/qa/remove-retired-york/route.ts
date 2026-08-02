import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function exactYork(value: unknown) {
  const address = String(value || "").trim().toLowerCase().replace(/\./g, "");
  return address === "55 york blvd" || address === "55 york boulevard";
}

function isDemoCustomer(customer: any) {
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

async function must<T = any>(promise: PromiseLike<{ data: T; error: any }>, label: string) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Preview Supabase service environment is unavailable.");
    const service = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as any;

    const candidates = await must<any[]>(
      service.from("properties").select("id,customer_id,address_line1").ilike("address_line1", "55 York%"),
      "load York properties",
    );
    const yorkProperties = (candidates || []).filter(property => exactYork(property.address_line1));
    const customerIds = unique(yorkProperties.map(property => property.customer_id));
    const customers = customerIds.length
      ? await must<any[]>(
          service.from("customers").select("id,full_name,email,notes").in("id", customerIds),
          "load York customers",
        )
      : [];
    const demoCustomerIds = new Set((customers || []).filter(isDemoCustomer).map(customer => String(customer.id)));
    const propertyIds = yorkProperties
      .filter(property => demoCustomerIds.has(String(property.customer_id)))
      .map(property => String(property.id));

    if (!propertyIds.length) {
      return NextResponse.json({ cleaned: true, removed: 0, remaining: 0, routes: [] });
    }

    const targets = await must<any[]>(
      service.from("visits")
        .select("id,route_id,job_id,customer_id,property_id,status,route_order,company_id,organization_id,created_at")
        .in("property_id", propertyIds)
        .neq("status", "cancelled"),
      "load retired York visits",
    );
    if ((targets || []).some(visit => String(visit.status) === "in_progress")) {
      throw new Error("The retired York demo visit is currently in progress.");
    }

    const routeReports: Array<{ routeId: string; removed: number; remaining: number; version: number }> = [];
    for (const routeId of unique((targets || []).map(visit => visit.route_id))) {
      const routeVisits = await must<any[]>(
        service.from("visits")
          .select("id,property_id,status,route_order,company_id,organization_id,created_at")
          .eq("route_id", routeId)
          .neq("status", "cancelled")
          .order("route_order", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true }),
        `load route ${routeId}`,
      );
      const routeTargets = (routeVisits || []).filter(visit => propertyIds.includes(String(visit.property_id)));
      if (!routeTargets.length) continue;

      const targetIds = new Set(routeTargets.map(visit => String(visit.id)));
      const remaining = (routeVisits || []).filter(visit => !targetIds.has(String(visit.id)));
      const remainingIds = new Set(remaining.map(visit => String(visit.id)));
      const companyId = String(routeVisits?.[0]?.company_id || routeVisits?.[0]?.organization_id || "");
      if (!companyId) throw new Error(`Route ${routeId} is missing its company ID.`);

      const storedStops = await must<any[]>(
        service.from("route_stops").select("visit_id,position").eq("route_id", routeId).order("position"),
        `load route stops ${routeId}`,
      );
      const storedOrder = (storedStops || [])
        .map(stop => String(stop.visit_id))
        .filter(visitId => remainingIds.has(visitId));
      const order = storedOrder.length === remaining.length ? storedOrder : projectedOrder(remaining);

      await must(service.from("route_stops").delete().eq("route_id", routeId), `clear route stops ${routeId}`);
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
        }).in("id", [...targetIds]),
        `cancel York visits ${routeId}`,
      );
      await must(
        service.from("visits").update({ route_order: null }).eq("route_id", routeId).neq("status", "cancelled"),
        `clear route projection ${routeId}`,
      );

      if (order.length) {
        await must(
          service.from("route_stops").insert(order.map((visitId: string, index: number) => ({
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
          service.from("visits").update({ route_order: index + 1 }).eq("route_id", routeId).eq("id", order[index]),
          `write visit order ${routeId}:${index + 1}`,
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
          last_source: "preview_remove_retired_demo_york",
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
        `reset route state ${routeId}`,
      );

      const verifiedStops = await must<any[]>(
        service.from("route_stops").select("visit_id,position").eq("route_id", routeId).order("position"),
        `verify route stops ${routeId}`,
      );
      const verifiedVisits = await must<any[]>(
        service.from("visits").select("id,route_order").eq("route_id", routeId).neq("status", "cancelled").order("route_order"),
        `verify route visits ${routeId}`,
      );
      const stopOrder = (verifiedStops || []).map(row => String(row.visit_id));
      const visitOrder = (verifiedVisits || []).map(row => String(row.id));
      if (stopOrder.join("|") !== order.join("|") || visitOrder.join("|") !== order.join("|")) {
        throw new Error(`Canonical order verification failed for route ${routeId}.`);
      }

      routeReports.push({ routeId, removed: routeTargets.length, remaining: order.length, version: nextVersion });
    }

    const jobIds = unique((targets || []).map(visit => visit.job_id));
    if (jobIds.length) await must(service.from("jobs").update({ active: false }).in("id", jobIds), "deactivate York jobs");
    if (demoCustomerIds.size) {
      await must(
        service.from("customers").update({ archived_at: new Date().toISOString() }).in("id", [...demoCustomerIds]),
        "archive York customers",
      );
    }

    const remainingVisits = await must<any[]>(
      service.from("visits").select("id").in("property_id", propertyIds).neq("status", "cancelled"),
      "verify York removal",
    );
    return NextResponse.json({
      cleaned: true,
      removed: routeReports.reduce((sum, route) => sum + route.removed, 0),
      remaining: (remainingVisits || []).length,
      routes: routeReports,
    });
  } catch (error) {
    console.error("qa-remove-retired-york", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Retired York cleanup failed." },
      { status: 500 },
    );
  }
}
