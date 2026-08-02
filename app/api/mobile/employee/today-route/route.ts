import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { repairLegacyDemoAssignments } from "@/lib/routes/routeAssignmentIntegrity";
import { normalizeVisitExecutionState } from "@/lib/visits/executionState";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Employee route service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function operationalDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function requireEmployee(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Employee.");

  const service = serviceClient();
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Employee login expired. Sign in again.");

  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id,role,active,company_id,organization_id,avatar_url")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.role !== "employee") {
    throw new Error("This login is not an active Employee account.");
  }

  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("This Employee profile is not linked to a company.");

  let employeeResult = await service
    .from("employees")
    .select("id,profile_id,company_id,organization_id,full_name,email,crew_id,active")
    .eq("profile_id", auth.user.id)
    .eq("active", true)
    .or(companyFilter(companyId))
    .maybeSingle();

  if (employeeResult.error) throw new Error(employeeResult.error.message);
  if (!employeeResult.data && auth.user.email) {
    employeeResult = await service
      .from("employees")
      .select("id,profile_id,company_id,organization_id,full_name,email,crew_id,active")
      .ilike("email", auth.user.email.trim())
      .eq("active", true)
      .or(companyFilter(companyId))
      .limit(1)
      .maybeSingle();
  }
  const employee = employeeResult.data;
  if (!employee) throw new Error("No active Employee record is linked to this login.");

  if (!employee.profile_id) {
    await service.from("employees").update({ profile_id: auth.user.id }).eq("id", employee.id);
  }

  return {
    service,
    employee,
    companyId: String(companyId),
    avatarUrl: profile.avatar_url || null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { service, employee, companyId, avatarUrl } = await requireEmployee(request);
    const date = request.nextUrl.searchParams.get("date") || operationalDateKey();
    const result = await service
      .from("visits")
      .select("id,job_id,route_id,customer_id,property_id,crew_id,assigned_employee_id,route_order,status,scheduled_date,started_at,finished_at,duration_seconds,created_at")
      .eq("scheduled_date", date)
      .neq("status", "cancelled")
      .or(companyFilter(companyId))
      .order("route_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (result.error) throw new Error(result.error.message);

    const allVisits = (result.data || []) as any[];
    const repairedIds = await repairLegacyDemoAssignments({
      service,
      companyId,
      employee: { id: employee.id, crew_id: employee.crew_id || null },
      visits: allVisits,
    });
    const repaired = new Set(repairedIds);
    for (const visit of allVisits) {
      if (repaired.has(visit.id)) {
        visit.assigned_employee_id = employee.id;
        visit.crew_id = employee.crew_id;
      }
    }

    const assignedVisits = allVisits.filter((visit: any) =>
      visit.assigned_employee_id === employee.id
      || (
        !visit.assigned_employee_id
        && Boolean(employee.crew_id)
        && visit.crew_id === employee.crew_id
      ));

    const assignedRouteIds = unique(assignedVisits.map((visit: any) => visit.route_id));
    const routeStopPositions = new Map<string, number>();
    const routeVersions = new Map<string, number>();

    if (assignedRouteIds.length) {
      const [routeStopsResult, routeStatesResult] = await Promise.all([
        service
          .from("route_stops")
          .select("route_id,visit_id,position")
          .in("route_id", assignedRouteIds),
        service
          .from("route_order_state")
          .select("route_id,version")
          .in("route_id", assignedRouteIds),
      ]);

      if (routeStopsResult.error) {
        console.warn("employee-today-route-stops", routeStopsResult.error.message);
      } else {
        for (const stop of routeStopsResult.data || []) {
          const position = Number((stop as any).position || 0);
          if ((stop as any).visit_id && Number.isInteger(position) && position > 0) {
            routeStopPositions.set(String((stop as any).visit_id), position);
          }
        }
      }

      if (routeStatesResult.error) {
        console.warn("employee-today-route-version", routeStatesResult.error.message);
      } else {
        for (const state of routeStatesResult.data || []) {
          const version = Number((state as any).version || 0);
          if ((state as any).route_id && Number.isInteger(version) && version > 0) {
            routeVersions.set(String((state as any).route_id), version);
          }
        }
      }
    }

    const routeRank = new Map(assignedRouteIds.map((routeId, index) => [routeId, index]));
    const orderedAssignedVisits = [...assignedVisits].sort((left: any, right: any) => {
      const leftRouteRank = routeRank.get(left.route_id) ?? 9999;
      const rightRouteRank = routeRank.get(right.route_id) ?? 9999;
      const leftOrder = routeStopPositions.get(String(left.id)) ?? left.route_order ?? 2147483647;
      const rightOrder = routeStopPositions.get(String(right.id)) ?? right.route_order ?? 2147483647;
      return leftRouteRank - rightRouteRank
        || leftOrder - rightOrder
        || String(left.created_at || "").localeCompare(String(right.created_at || ""))
        || String(left.id).localeCompare(String(right.id));
    });

    const propertyIds = unique(orderedAssignedVisits.map((visit: any) => visit.property_id));
    const customerIds = unique(orderedAssignedVisits.map((visit: any) => visit.customer_id));
    const jobIds = unique(orderedAssignedVisits.map((visit: any) => visit.job_id));
    const empty = Promise.resolve({ data: [] as any[], error: null });

    const [propertiesResult, customersResult, jobsResult] = await Promise.all([
      propertyIds.length
        ? service.from("properties").select("id,address_line1,city,province,postal_code").in("id", propertyIds)
        : empty,
      customerIds.length
        ? service.from("customers").select("id,full_name").in("id", customerIds)
        : empty,
      jobIds.length
        ? service.from("jobs").select("id,service_name").in("id", jobIds)
        : empty,
    ]);

    for (const current of [propertiesResult, customersResult, jobsResult]) {
      if (current.error) throw new Error(current.error.message);
    }

    const properties = new Map((propertiesResult.data || []).map((row: any) => [row.id, row]));
    const customers = new Map((customersResult.data || []).map((row: any) => [row.id, row]));
    const jobs = new Map((jobsResult.data || []).map((row: any) => [row.id, row]));

    const stops = orderedAssignedVisits.map((visit: any) => {
      const property = properties.get(visit.property_id) as any;
      const customer = customers.get(visit.customer_id) as any;
      const job = jobs.get(visit.job_id) as any;
      const execution = normalizeVisitExecutionState({
        status: visit.status,
        startedAt: visit.started_at,
        finishedAt: visit.finished_at,
        durationSeconds: visit.duration_seconds,
      });
      return {
        visitId: visit.id,
        jobId: visit.job_id,
        customerId: visit.customer_id,
        propertyId: visit.property_id,
        routeId: visit.route_id || null,
        addressLine1: property?.address_line1 || "",
        city: property?.city || "",
        province: property?.province || "",
        postalCode: property?.postal_code || "",
        latitude: null,
        longitude: null,
        routeOrder: routeStopPositions.get(String(visit.id)) ?? visit.route_order,
        status: visit.status,
        customerName: customer?.full_name || "Customer",
        serviceName: job?.service_name || "Property Service",
        scheduledDate: visit.scheduled_date,
        startedAt: execution.startedAt || null,
        finishedAt: execution.finishedAt || null,
        durationSeconds: execution.durationSeconds ?? null,
        employeeNotes: null,
      };
    });

    const routeId = stops.find((stop: any) => stop.routeId)?.routeId || null;
    const routeVersion = routeId
      ? routeVersions.get(String(routeId)) ?? 1
      : null;
    const canonicalOrderSource = routeStopPositions.size ? "route_stops_v2" : "visits_route_order";

    console.info("employee-today-route-ok", {
      employeeId: employee.id,
      companyId,
      date,
      routeId,
      routeVersion,
      canonicalOrderSource,
      repairedDemoAssignmentCount: repairedIds.length,
      stopCount: stops.length,
      routeLinkedCount: stops.filter((stop: any) => Boolean(stop.routeId)).length,
      unlinkedAssignedCount: stops.filter((stop: any) => !stop.routeId).length,
      visitIds: stops.map((stop: any) => stop.visitId),
    });

    return NextResponse.json({
      employee: {
        id: employee.id,
        profileId: employee.profile_id || null,
        companyId,
        name: employee.full_name || "Employee",
        crewId: employee.crew_id || null,
        email: employee.email || null,
        avatarUrl,
      },
      routeId,
      routeVersion,
      date,
      stops,
      repairedDemoAssignmentCount: repairedIds.length,
    });
  } catch (error) {
    console.error("employee-today-route", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Employee route could not be loaded." },
      { status: 400 },
    );
  }
}