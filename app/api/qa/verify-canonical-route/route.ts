import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ROUTE_ID = "7ce39ec5-b1c5-4ef8-bf3b-8fd01138e3d4";

function exactYork(value: unknown) {
  const address = String(value || "").trim().toLowerCase().replace(/\./g, "");
  return address === "55 york blvd" || address === "55 york boulevard";
}

function isDemo(customer: any) {
  return /^demo customer\b/i.test(String(customer?.full_name || ""))
    || /@4everseasons\.test$/i.test(String(customer?.email || ""))
    || /\[TEMP_DEMO_SANDBOX_V1\]/i.test(String(customer?.notes || ""));
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
    const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;

    const candidates = await must<any[]>(
      service.from("properties").select("id,customer_id,address_line1").ilike("address_line1", "55 York%"),
      "load York properties",
    );
    const york = (candidates || []).filter(property => exactYork(property.address_line1));
    const customerIds = [...new Set(york.map(property => String(property.customer_id)).filter(Boolean))];
    const customers = customerIds.length
      ? await must<any[]>(service.from("customers").select("id,full_name,email,notes").in("id", customerIds), "load York customers")
      : [];
    const demoIds = new Set((customers || []).filter(isDemo).map(customer => String(customer.id)));
    const demoPropertyIds = york.filter(property => demoIds.has(String(property.customer_id))).map(property => String(property.id));
    const activeYork = demoPropertyIds.length
      ? await must<any[]>(
          service.from("visits").select("id,route_id,status,property_id").in("property_id", demoPropertyIds).neq("status", "cancelled"),
          "verify York visits",
        )
      : [];

    const visits = await must<any[]>(
      service.from("visits").select("id,route_order,status").eq("route_id", ROUTE_ID).neq("status", "cancelled").order("route_order"),
      "load canonical visits",
    );
    const stops = await must<any[]>(
      service.from("route_stops").select("visit_id,position").eq("route_id", ROUTE_ID).order("position"),
      "load canonical stops",
    );
    const state = await must<any>(
      service.from("route_order_state").select("version,last_source").eq("route_id", ROUTE_ID).maybeSingle(),
      "load canonical version",
    );
    const smart = await must<any>(
      service.from("employee_smart_route_state").select("active,applied_order,route_version,origin_label,origin_latitude,origin_longitude").eq("route_id", ROUTE_ID).maybeSingle(),
      "load Smart Route state",
    );

    const visitOrder = (visits || []).map(row => String(row.id));
    const stopOrder = (stops || []).map(row => String(row.visit_id));
    const smartOrder = Array.isArray(smart?.applied_order) ? smart.applied_order.map(String) : [];
    const uniqueStops = new Set(stopOrder).size === stopOrder.length;
    const projectionMatches = visitOrder.join("|") === stopOrder.join("|");
    const smartMatches = !smart?.active || smartOrder.join("|") === stopOrder.join("|");

    const ok = (activeYork || []).length === 0
      && visits.length === stops.length
      && uniqueStops
      && projectionMatches
      && smartMatches;

    return NextResponse.json({
      ok,
      routeId: ROUTE_ID,
      version: Number(state?.version || 0),
      source: state?.last_source || null,
      activeYorkVisits: (activeYork || []).length,
      visits: visits.length,
      stops: stops.length,
      uniqueStops,
      projectionMatches,
      smartActive: Boolean(smart?.active),
      smartMatches,
      routeVersion: Number(smart?.route_version || 0),
      origin: smart ? {
        label: smart.origin_label,
        latitude: smart.origin_latitude,
        longitude: smart.origin_longitude,
      } : null,
    }, { status: ok ? 200 : 409 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Canonical route verification failed." },
      { status: 500 },
    );
  }
}
