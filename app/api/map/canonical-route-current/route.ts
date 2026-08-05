import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET as loadBaseSnapshot } from "../canonical-route/route";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Canonical route current reader is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function GET(request: NextRequest) {
  const baseResponse = await loadBaseSnapshot(request);
  if (!baseResponse.ok) return baseResponse;

  try {
    const snapshot = await baseResponse.json() as Record<string, any>;
    const routeId = String(snapshot.routeId || "").trim();
    if (!routeId) throw new Error("Canonical snapshot returned no routeId.");

    const service = serviceClient();
    const [statesResult, smartResult, stopsResult, auditsResult] = await Promise.all([
      service
        .from("route_order_state")
        .select("version,last_source,last_actor_profile_id,updated_at")
        .eq("route_id", routeId)
        .order("version", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(10),
      service
        .from("employee_smart_route_state")
        .select("active,route_version,origin_label,origin_latitude,origin_longitude,original_order,applied_order,applied_at,updated_at")
        .eq("route_id", routeId)
        .order("route_version", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(10),
      service
        .from("route_stops")
        .select("visit_id,position,updated_at")
        .eq("route_id", routeId)
        .order("position", { ascending: true }),
      service
        .from("route_order_audit")
        .select("source,previous_order,next_order,route_version,created_at")
        .eq("route_id", routeId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    if (statesResult.error) throw new Error(statesResult.error.message);
    if (smartResult.error) throw new Error(smartResult.error.message);
    if (stopsResult.error) throw new Error(stopsResult.error.message);
    if (auditsResult.error) {
      console.warn("canonical-route-current-audit", auditsResult.error.message);
    }

    const stateRows = statesResult.data || [];
    const smartRows = smartResult.data || [];
    const state = stateRows[0] || null;
    const smart = smartRows[0] || null;
    const stateVersion = numeric(state?.version) || 0;
    const smartVersion = numeric(smart?.route_version) || 0;
    const snapshotVersion = numeric(snapshot.routeVersion) || 0;
    const routeVersion = Math.max(stateVersion, smartVersion, snapshotVersion);

    let origin = snapshot.origin || null;
    const smartLatitude = numeric(smart?.origin_latitude);
    const smartLongitude = numeric(smart?.origin_longitude);
    if (
      smart?.active
      && smartVersion === routeVersion
      && smartLatitude !== null
      && smartLongitude !== null
    ) {
      origin = {
        label: String(smart.origin_label || "Route start"),
        address: null,
        latitude: smartLatitude,
        longitude: smartLongitude,
      };
    }

    const updatedAt = [snapshot.updatedAt, state?.updated_at, smart?.updated_at]
      .filter(Boolean)
      .map(String)
      .sort()
      .at(-1) || new Date().toISOString();

    const response: Record<string, any> = {
      ...snapshot,
      routeVersion,
      origin,
      updatedAt,
    };

    console.info("canonical-route-current-persistence", {
      routeId,
      stateRowCount: stateRows.length,
      stateRows: stateRows.map((row: any) => ({
        version: Number(row.version || 0),
        lastSource: row.last_source || null,
        lastActorProfileId: row.last_actor_profile_id || null,
        updatedAt: row.updated_at || null,
      })),
      smartRowCount: smartRows.length,
      smartRows: smartRows.map((row: any) => ({
        active: Boolean(row.active),
        routeVersion: Number(row.route_version || 0),
        appliedAt: row.applied_at || null,
        updatedAt: row.updated_at || null,
        origin: {
          label: row.origin_label || "",
          latitude: numeric(row.origin_latitude),
          longitude: numeric(row.origin_longitude),
        },
        originalOrder: Array.isArray(row.original_order) ? row.original_order.map(String) : [],
        appliedOrder: Array.isArray(row.applied_order) ? row.applied_order.map(String) : [],
      })),
      routeStops: (stopsResult.data || []).map((row: any) => ({
        visitId: String(row.visit_id),
        position: Number(row.position),
        updatedAt: row.updated_at || null,
      })),
      audits: (auditsResult.data || []).map((row: any) => ({
        source: row.source || null,
        routeVersion: Number(row.route_version || 0),
        createdAt: row.created_at || null,
        previousOrder: Array.isArray(row.previous_order) ? row.previous_order.map(String) : [],
        nextOrder: Array.isArray(row.next_order) ? row.next_order.map(String) : [],
      })),
    });

    console.info("canonical-route-current-ok", {
      routeId,
      routeVersion,
      snapshotVersion,
      stateVersion,
      smartVersion,
      firstVisitId: response.orderedVisitIds?.[0] || null,
      stopCount: response.stops?.length || 0,
    });

    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("canonical-route-current", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Current canonical route could not be loaded." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
