import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type Point = { id: string; latitude: number; longitude: number };
type Origin = { label: string; latitude: number; longitude: number };

function failure(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Smart Route failed." }, { status });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Smart Route service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function authClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Employee authentication is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;
}

async function context(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Employee.");
  const userClient = authClient(token);
  const { data: auth, error: authError } = await userClient.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Employee login expired. Sign in again.");
  const service = serviceClient();
  const { data: profile } = await service.from("profiles").select("id,role,active,company_id,organization_id").eq("id", auth.user.id).maybeSingle();
  if (!profile?.active || profile.role !== "employee") throw new Error("This login is not an active Employee account.");
  const companyId = profile.company_id || profile.organization_id;
  const { data: employee } = await service.from("employees").select("id,crew_id,active,company_id,organization_id").eq("profile_id", auth.user.id).eq("active", true).maybeSingle();
  if (!employee || (employee.company_id || employee.organization_id) !== companyId) throw new Error("No canonical Employee is linked to this login.");
  return { service, employee, companyId, userId: auth.user.id };
}

async function allowedVisits(service: any, routeId: string, employee: any, companyId: string) {
  const { data, error } = await service.from("visits")
    .select("id,status,assigned_employee_id,crew_id,route_order")
    .eq("route_id", routeId)
    .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
    .order("route_order", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  const visits = (data || []).filter((visit: any) => String(visit.status) !== "cancelled" && (
    visit.assigned_employee_id === employee.id || (!visit.assigned_employee_id && employee.crew_id && visit.crew_id === employee.crew_id)
  ));
  if (!visits.length) throw new Error("This route has no active visits assigned to you.");
  return visits;
}

async function roadMatrix(origin: Origin, stops: Point[]) {
  const points = [origin, ...stops];
  const encoded = points.map(point => `${point.longitude},${point.latitude}`).join(";");
  const response = await fetch(`https://router.project-osrm.org/table/v1/driving/${encoded}?annotations=distance,duration`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Road optimizer returned ${response.status}.`);
  const result = await response.json() as { code?: string; distances?: Array<Array<number | null>>; durations?: Array<Array<number | null>> };
  if (result.code !== "Ok" || !result.distances || !result.durations) throw new Error("Road distances could not be calculated.");
  return { distances: result.distances, durations: result.durations };
}

function pathCost(order: number[], matrix: Array<Array<number | null>>) {
  let total = 0;
  let previous = 0;
  for (const stop of order) {
    const value = matrix[previous]?.[stop];
    if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
    total += Number(value);
    previous = stop;
  }
  return total;
}

function exactRoadOrder(count: number, matrix: Array<Array<number | null>>, alternative: number) {
  if (count < 1) return [];
  if (count > 18) throw new Error("Smart Route supports up to 18 houses at a time.");

  const starts = Array.from({ length: count }, (_, index) => index + 1)
    .sort((left, right) => Number(matrix[0]?.[left] ?? Number.POSITIVE_INFINITY) - Number(matrix[0]?.[right] ?? Number.POSITIVE_INFINITY));
  const forcedFirst = alternative > 0 ? starts[(alternative - 1) % starts.length] : null;
  const size = 1 << count;
  const width = count;
  const costs = new Float64Array(size * width);
  costs.fill(Number.POSITIVE_INFINITY);
  const parents = new Int16Array(size * width);
  parents.fill(-1);

  for (let stop = 0; stop < count; stop += 1) {
    const point = stop + 1;
    if (forcedFirst && point !== forcedFirst) continue;
    const edge = Number(matrix[0]?.[point] ?? Number.POSITIVE_INFINITY);
    if (Number.isFinite(edge)) costs[(1 << stop) * width + stop] = edge;
  }

  for (let mask = 1; mask < size; mask += 1) {
    for (let last = 0; last < count; last += 1) {
      if (!(mask & (1 << last))) continue;
      const base = costs[mask * width + last];
      if (!Number.isFinite(base)) continue;
      for (let next = 0; next < count; next += 1) {
        if (mask & (1 << next)) continue;
        const edge = Number(matrix[last + 1]?.[next + 1] ?? Number.POSITIVE_INFINITY);
        if (!Number.isFinite(edge)) continue;
        const nextMask = mask | (1 << next);
        const position = nextMask * width + next;
        const candidate = base + edge;
        if (candidate < costs[position]) {
          costs[position] = candidate;
          parents[position] = last;
        }
      }
    }
  }

  const fullMask = size - 1;
  let last = -1;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const value = costs[fullMask * width + index];
    if (value < best) { best = value; last = index; }
  }
  if (last < 0 || !Number.isFinite(best)) throw new Error("A complete driving route could not be calculated for these houses.");

  const reversed: number[] = [];
  let mask = fullMask;
  while (last >= 0) {
    reversed.push(last + 1);
    const parent = parents[mask * width + last];
    mask ^= 1 << last;
    last = parent;
  }
  return reversed.reverse();
}

export async function POST(request: NextRequest) {
  try {
    const { service, employee, companyId, userId } = await context(request);
    const body = await request.json() as {
      action?: "optimize" | "apply";
      routeId?: string;
      origin?: Origin;
      stops?: Point[];
      alternative?: number;
      originalOrder?: string[];
      appliedOrder?: string[];
    };
    if (!body.routeId) throw new Error("A canonical route is required.");
    const visits = await allowedVisits(service, body.routeId, employee, companyId);
    const allowed = new Set(visits.map((visit: any) => visit.id));

    if (body.action === "optimize") {
      if (!body.origin || !Array.isArray(body.stops) || !body.stops.length) throw new Error("Choose a starting point and at least one stop.");
      const stops = body.stops.filter(stop => allowed.has(stop.id) && Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude));
      if (stops.length !== body.stops.length) throw new Error("One or more stops do not belong to this Employee route.");
      const matrix = await roadMatrix(body.origin, stops);
      const order = exactRoadOrder(stops.length, matrix.durations, Math.max(0, Number(body.alternative || 0)));
      const orderedIds = order.map(index => stops[index - 1].id);
      return NextResponse.json({
        orderedIds,
        distanceMeters: pathCost(order, matrix.distances),
        durationSeconds: pathCost(order, matrix.durations),
        alternative: Number(body.alternative || 0),
      });
    }

    if (body.action !== "apply") throw new Error("Choose a valid Smart Route action.");
    const originalOrder = (body.originalOrder || []).filter(id => allowed.has(id));
    const selected = (body.appliedOrder || []).filter((id, index, values) => allowed.has(id) && values.indexOf(id) === index);
    const finalOrder = [...selected, ...originalOrder.filter(id => !selected.includes(id)), ...visits.map((visit: any) => visit.id).filter((id: string) => !selected.includes(id) && !originalOrder.includes(id))];
    if (!finalOrder.length) throw new Error("The Smart Route has no valid visits.");
    const previousOrders = new Map(visits.map((visit: any) => [visit.id, visit.route_order]));
    try {
      for (let index = 0; index < finalOrder.length; index += 1) {
        const { error } = await service.from("visits")
          .update({ route_order: 100000 + index })
          .eq("id", finalOrder[index])
          .eq("route_id", body.routeId);
        if (error) throw new Error(error.message);
      }
      for (let index = 0; index < finalOrder.length; index += 1) {
        const { error } = await service.from("visits")
          .update({ route_order: index + 1 })
          .eq("id", finalOrder[index])
          .eq("route_id", body.routeId);
        if (error) throw new Error(error.message);
      }
    } catch (error) {
      for (const [visitId, routeOrder] of previousOrders) {
        await service.from("visits").update({ route_order: routeOrder }).eq("id", visitId).eq("route_id", body.routeId);
      }
      throw error;
    }
    await service.from("employee_smart_route_state").upsert({
      company_id: companyId,
      route_id: body.routeId,
      crew_id: employee.crew_id,
      route_date: new Date().toISOString().slice(0, 10),
      original_order: originalOrder.length ? originalOrder : visits.map((visit: any) => visit.id),
      applied_order: finalOrder,
      origin_label: body.origin?.label || "",
      origin_latitude: body.origin?.latitude ?? null,
      origin_longitude: body.origin?.longitude ?? null,
      active: true,
      applied_by_profile_id: userId,
      applied_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "route_id" });
    return NextResponse.json({ ok: true, count: finalOrder.length, appliedOrder: finalOrder });
  } catch (error) {
    return failure(error, /expired|sign in|active Employee|linked/i.test(error instanceof Error ? error.message : "") ? 401 : 400);
  }
}
