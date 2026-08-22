import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { SupabaseAny } from "./fixture-env";
import { insertRowsWithFallback } from "./fixture-db";
import type { OperatorFixture } from "./fixture-types";

export async function assertCanonicalRouteOrder(db: SupabaseAny, routeId: string, expectedCount: number) {
  const stops = await db.from("route_stops")
    .select("visit_id,position")
    .eq("route_id", routeId)
    .order("position", { ascending: true });
  expect(stops.error, stops.error?.message).toBeNull();
  expect(stops.data || []).toHaveLength(expectedCount);

  const visitIds = (stops.data || []).map((row: any) => String(row.visit_id));
  const visits = await db.from("visits")
    .select("id,route_order,status")
    .in("id", visitIds)
    .neq("status", "cancelled");
  expect(visits.error, visits.error?.message).toBeNull();
  const byId = new Map((visits.data || []).map((visit: any) => [String(visit.id), visit]));
  for (let index = 0; index < visitIds.length; index += 1) {
    const stop = stops.data[index];
    const visit = byId.get(visitIds[index]);
    expect(Number(stop.position), "route_stops positions must be compact").toBe(index + 1);
    expect(Number(visit?.route_order), "visits.route_order must project route_stops.position").toBe(index + 1);
  }
  return visitIds;
}

export async function attachQaVisitPhoto(db: SupabaseAny, fixture: OperatorFixture, visitId: string) {
  const path = `${fixture.companyId}/${fixture.namespace}/employee-finish.png`;
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const upload = await db.storage.from("work-photos").upload(path, bytes, {
    upsert: true,
    contentType: "image/png",
  });
  expect(upload.error, upload.error?.message).toBeNull();
  fixture.created.storagePaths.push(path);

  await insertRowsWithFallback(db, "photos", [{
    id: randomUUID(),
    organization_id: fixture.companyId,
    company_id: fixture.companyId,
    property_id: fixture.customer.propertyId,
    visit_id: visitId,
    uploaded_by: fixture.employee.profileId,
    storage_bucket: "work-photos",
    storage_path: path,
    public_url: null,
    photo_type: "completion",
    caption: "QA Browser Operator completion fixture",
    sort_order: 1,
    is_profile: false,
  }], ["company_id", "storage_bucket", "caption", "sort_order", "is_profile"]);
  return path;
}
