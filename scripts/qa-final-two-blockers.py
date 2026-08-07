from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing patch anchor: {label}")
    return text.replace(old, new, 1)


# Blocker 1: keep Exception Week reads on the existing company/job/date Visit index
# instead of a wide customer IN + tenant OR + database sort.
exceptions_path = Path("app/api/admin/operational-simulator/exceptions/route.ts")
text = exceptions_path.read_text()
text = replace_once(
    text,
    "  route_id: string | null;\n  scheduled_date: string;",
    "  route_id: string | null;\n  route_order: number | null;\n  scheduled_date: string;",
    "VisitRow route_order",
)
start = text.index("async function completedVisits(")
end = text.index("\n\nasync function exceptionStatus", start)
completed_visits = '''async function completedVisits(service: any, companyId: string, customerIds: string[]): Promise<VisitRow[]> {
  if (!customerIds.length) return [];

  // Simulation rows always carry company_id. Resolve their Jobs first so the
  // Visit lookup stays on the existing company/job/date index and avoids a
  // wide customer IN + tenant OR + database sort across the full Visits table.
  const jobs = await service.from("jobs")
    .select("id")
    .eq("company_id", companyId)
    .in("customer_id", customerIds);
  if (jobs.error) throw new Error(`jobs: ${jobs.error.message}`);
  const jobIds = (jobs.data || []).map((row: any) => String(row.id));
  if (!jobIds.length) return [];

  const rows: VisitRow[] = [];
  for (let offset = 0; offset < jobIds.length; offset += 12) {
    const result = await service.from("visits")
      .select("id,customer_id,route_id,route_order,scheduled_date,status,started_at,finished_at,duration_seconds,employee_notes,customer_visible_summary")
      .eq("company_id", companyId)
      .in("job_id", jobIds.slice(offset, offset + 12))
      .eq("status", "completed")
      .limit(120);
    if (result.error) throw new Error(`visits: ${result.error.message}`);
    rows.push(...((result.data || []) as VisitRow[]));
  }

  return rows.sort((left, right) =>
    String(right.scheduled_date).localeCompare(String(left.scheduled_date))
    || Number(left.route_order ?? 2147483647) - Number(right.route_order ?? 2147483647)
    || left.id.localeCompare(right.id));
}'''
text = text[:start] + completed_visits + text[end:]
exceptions_path.write_text(text)


# Blocker 2: older deployments expose the safe one-way helper
# sync_visit_route_order_for_route but do not yet grant service_role access to
# sync_canonical_route_stops_v2. Prefer that transaction-level helper before the
# bounded per-row compatibility path. It projects only route_stops -> visits and
# avoids temporary route positions that the active canonical guard must reject.
projection_path = Path("lib/routes/projectCanonicalVisitOrderCompatibility.ts")
text = projection_path.read_text()
anchor = '''  const normalized = stops.map(stop => {
    const position = Number(stop.position);
    if (!stop.visit_id || !Number.isInteger(position) || position < 1) {
      throw new Error("Canonical Route contains an invalid stop projection.");
    }
    return { visitId: String(stop.visit_id), position };
  });

  // Two-phase projection avoids the unique (route, route_order) constraint while
'''
replacement = '''  const normalized = stops.map(stop => {
    const position = Number(stop.position);
    if (!stop.visit_id || !Number.isInteger(position) || position < 1) {
      throw new Error("Canonical Route contains an invalid stop projection.");
    }
    return { visitId: String(stop.visit_id), position };
  });

  // Older canonical deployments already expose this one-way SECURITY DEFINER
  // helper. It updates the entire Visit projection inside one transaction, so
  // the deferrable route-order constraint can settle on the final canonical
  // positions without using staging values. Legacy Visit triggers therefore see
  // only the exact route_stops positions accepted by the active-route guard.
  const transactionalProjection = await service.rpc("sync_visit_route_order_for_route", {
    p_route_id: routeId,
  });
  if (!transactionalProjection.error) {
    const verified = await service
      .from("visits")
      .select("id,route_order,status")
      .eq("route_id", routeId)
      .neq("status", "cancelled")
      .order("route_order", { ascending: true, nullsFirst: false });
    if (verified.error) throw new Error(verified.error.message);
    const projectedVisitIds = (verified.data || []).map((row: any) => String(row.id));
    const canonicalVisitIds = normalized.map(stop => stop.visitId);
    if (
      projectedVisitIds.length !== canonicalVisitIds.length
      || projectedVisitIds.some((visitId: string, index: number) => visitId !== canonicalVisitIds[index])
    ) {
      throw new Error("Canonical Visit projection helper returned without the exact route_stops order.");
    }
    return {
      fallback: true,
      transactional: true,
      routeId,
      count: normalized.length,
      orderedVisitIds: canonicalVisitIds,
    };
  }

  const helperMessage = String(transactionalProjection.error.message || "");
  if (!/sync_visit_route_order_for_route|schema cache|could not find the function|permission denied/i.test(helperMessage)) {
    throw new Error(helperMessage || "Canonical Route Visit projection helper failed.");
  }

  // Last-resort path for deployments that predate the transaction-level helper.
  // Two-phase projection avoids the unique (route, route_order) constraint while
'''
text = replace_once(text, anchor, replacement, "transactional compatibility projection")
projection_path.write_text(text)


# Newly exposed Operational blocker: the legacy feedback RPC performs the write
# and then rebuilds the whole Customer board in the same statement. On a loaded
# QA tenant that can cross the database statement limit even though each operation
# succeeds independently. A canceled PostgreSQL statement is transactional, so it
# is safe to use the existing authenticated server-action fallback and then reload
# the board in a separate request; no timeout or assertion is relaxed.
portal_path = Path("lib/repositories/customerPortalRepository.ts")
text = portal_path.read_text()
text = replace_once(
    text,
    '''  return error?.code === "PGRST202"
    || error?.code === "42501"
    || error?.code === "42703"
    || /could not find the function public\\.(create_customer_portal_request|submit_customer_portal_feedback)|schema cache|permission denied|column .*company_id.*does not exist/i.test(message);''',
    '''  return error?.code === "PGRST202"
    || error?.code === "42501"
    || error?.code === "42703"
    || error?.code === "57014"
    || /could not find the function public\\.(create_customer_portal_request|submit_customer_portal_feedback)|schema cache|permission denied|column .*company_id.*does not exist|canceling statement due to statement timeout/i.test(message);''',
    "customer portal statement-timeout fallback",
)
portal_path.write_text(text)

print("Remaining QA blocker candidates applied.")
