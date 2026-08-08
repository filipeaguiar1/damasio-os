from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing patch anchor: {label}")
    return text.replace(old, new, 1)


# Exception Week: keep completed-Visit reads on the existing company/job/date
# index instead of a wide customer IN + tenant OR + database sort.
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


# Operational Simulator cleanup: old runs were archived after protected Visit
# deletion failed, then ignored forever by later cleanups. Include those archived
# QA-only Customers and keep every historical lookup/delete bounded.
simulator_path = Path("app/api/admin/operational-simulator/route.ts")
text = simulator_path.read_text()
text = replace_once(
    text,
    '''  const customers = await service.from("customers").select("id,profile_id")
    .or(companyFilter(companyId)).like("email", pattern).is("archived_at", null);''',
    '''  // Include archived simulator Customers so old protected Visit residue is not
  // left behind forever. The email pattern is company-scoped and QA-only.
  const customers = await service.from("customers").select("id,profile_id")
    .or(companyFilter(companyId)).like("email", pattern);''',
    "include archived simulator customers",
)

old_lookup = '''  const properties = customerIds.length ? await service.from("properties").select("id").in("customer_id", customerIds) : { data: [], error: null };
  if (properties.error) throw new Error(properties.error.message);
  const propertyIds = (properties.data || []).map((row: any) => String(row.id));
  const jobs = customerIds.length ? await service.from("jobs").select("id").in("customer_id", customerIds) : { data: [], error: null };
  if (jobs.error) throw new Error(jobs.error.message);
  const jobIds = (jobs.data || []).map((row: any) => String(row.id));
  const visits = customerIds.length ? await service.from("visits").select("id,route_id").in("customer_id", customerIds) : { data: [], error: null };
  if (visits.error) throw new Error(visits.error.message);
  const visitIds = (visits.data || []).map((row: any) => String(row.id));
  const routeIds = [...new Set((visits.data || []).map((row: any) => row.route_id ? String(row.route_id) : "").filter(Boolean))];
  const employees = profileIds.length ? await service.from("employees").select("id,crew_id").in("profile_id", profileIds) : { data: [], error: null };
  if (employees.error) throw new Error(employees.error.message);
  const employeeIds = (employees.data || []).map((row: any) => String(row.id));
  const crewIds = [...new Set((employees.data || []).map((row: any) => row.crew_id ? String(row.crew_id) : "").filter(Boolean))];'''
new_lookup = '''  async function collectInBatches(table: string, columns: string, field: string, ids: string[]) {
    const rows: any[] = [];
    for (const batch of chunks(ids, 25)) {
      const result = await service.from(table).select(columns).in(field, batch);
      if (result.error) throw new Error(`${table}: ${result.error.message}`);
      rows.push(...(result.data || []));
    }
    return rows;
  }

  const propertyRows = await collectInBatches("properties", "id", "customer_id", customerIds);
  const propertyIds = propertyRows.map((row: any) => String(row.id));
  const jobRows = await collectInBatches("jobs", "id", "customer_id", customerIds);
  const jobIds = jobRows.map((row: any) => String(row.id));
  const visitRows = await collectInBatches("visits", "id,route_id", "customer_id", customerIds);
  const visitIds = visitRows.map((row: any) => String(row.id));
  const routeIds = [...new Set(visitRows.map((row: any) => row.route_id ? String(row.route_id) : "").filter(Boolean))];
  const employeeRows = await collectInBatches("employees", "id,crew_id", "profile_id", profileIds);
  const employeeIds = employeeRows.map((row: any) => String(row.id));
  const crewIds = [...new Set(employeeRows.map((row: any) => row.crew_id ? String(row.crew_id) : "").filter(Boolean))];'''
text = replace_once(text, old_lookup, new_lookup, "bounded simulator dependency lookups")

old_remove_helper = '''  async function remove(label: string, operation: PromiseLike<{ error?: { message?: string } | null }>, optional = false) {
    const result = await operation;
    if (!result.error) return true;
    const message = result.error.message || "cleanup failed";
    if (optional && (missingColumn(message) || /permission denied/i.test(message))) {
      console.warn(`operational-simulator cleanup skipped ${label}: ${message}`);
      return false;
    }
    throw new Error(`${label}: ${message}`);
  }
'''
new_remove_helper = '''  async function remove(label: string, operation: PromiseLike<{ error?: { message?: string } | null }>, optional = false) {
    const result = await operation;
    if (!result.error) return true;
    const message = result.error.message || "cleanup failed";
    if (optional && (missingColumn(message) || /permission denied/i.test(message))) {
      console.warn(`operational-simulator cleanup skipped ${label}: ${message}`);
      return false;
    }
    throw new Error(`${label}: ${message}`);
  }

  async function removeByIds(label: string, table: string, field: string, ids: string[], optional = false) {
    let removed = true;
    for (const batch of chunks(ids, 25)) {
      const batchRemoved = await remove(label, service.from(table).delete().in(field, batch), optional);
      removed = batchRemoved && removed;
    }
    return removed;
  }

  async function updateByIds(label: string, table: string, values: Record<string, unknown>, field: string, ids: string[], optional = false) {
    let updated = true;
    for (const batch of chunks(ids, 25)) {
      const batchUpdated = await remove(label, service.from(table).update(values).in(field, batch), optional);
      updated = batchUpdated && updated;
    }
    return updated;
  }
'''
text = replace_once(text, old_remove_helper, new_remove_helper, "batched simulator mutation helpers")

old_children = '''  if (customerIds.length) {
    await remove("feedback", service.from("feedback").delete().in("customer_id", customerIds));
    await remove("tasks", service.from("tasks").delete().in("customer_id", customerIds));
    await remove("service_requests", service.from("service_requests").delete().in("customer_id", customerIds));
    await remove("payments", service.from("payments").delete().in("customer_id", customerIds), true);
  }
  // Every simulator Photo is linked to its Property as well as its Visit. Deleting by
  // Property keeps the request bounded and avoids oversized Visit-ID filters after legacy runs.
  if (propertyIds.length) await remove("property photos", service.from("photos").delete().in("property_id", propertyIds));
  if (routeIds.length) {
    await remove("employee_smart_route_state", service.from("employee_smart_route_state").delete().in("route_id", routeIds));
    await remove("route_stops", service.from("route_stops").delete().in("route_id", routeIds));
    await remove("route_order_state", service.from("route_order_state").delete().in("route_id", routeIds));
    await remove("route_map_cache", service.from("route_map_cache").delete().in("route_id", routeIds), true);
  }
  if (jobIds.length) await remove("job invoice links", service.from("jobs").update({ invoice_id: null }).in("id", jobIds), true);'''
new_children = '''  if (customerIds.length) {
    await removeByIds("feedback", "feedback", "customer_id", customerIds);
    await removeByIds("tasks", "tasks", "customer_id", customerIds);
    await removeByIds("service_requests", "service_requests", "customer_id", customerIds);
    await removeByIds("payments", "payments", "customer_id", customerIds, true);
  }
  if (propertyIds.length) await removeByIds("property photos", "photos", "property_id", propertyIds);
  if (routeIds.length) {
    await removeByIds("employee_smart_route_state", "employee_smart_route_state", "route_id", routeIds);
    await removeByIds("route_stops", "route_stops", "route_id", routeIds);
    await removeByIds("route_order_state", "route_order_state", "route_id", routeIds);
    await removeByIds("route_map_cache", "route_map_cache", "route_id", routeIds, true);
  }
  if (jobIds.length) await updateByIds("job invoice links", "jobs", { invoice_id: null }, "id", jobIds, true);'''
text = replace_once(text, old_children, new_children, "bounded simulator child cleanup")

old_visit_delete = '''  let visitsDeleted = true;
  if (customerIds.length) {
    await remove("invoices", service.from("invoices").delete().in("customer_id", customerIds));
    visitsDeleted = await remove("visits", service.from("visits").delete().in("customer_id", customerIds), true);
  }
'''
new_visit_delete = '''  let visitsDeleted = true;
  if (customerIds.length) {
    await removeByIds("invoices", "invoices", "customer_id", customerIds);

    async function cleanupVisitBatch(batch: string[]): Promise<boolean> {
      const cleanup = await service.rpc("cleanup_operational_simulation_visits", {
        p_company_id: companyId,
        p_customer_ids: batch,
      });
      if (!cleanup.error) return true;
      const message = String(cleanup.error.message || "");
      if (/statement timeout/i.test(message) && batch.length > 1) {
        const midpoint = Math.ceil(batch.length / 2);
        const left = await cleanupVisitBatch(batch.slice(0, midpoint));
        const right = await cleanupVisitBatch(batch.slice(midpoint));
        return left && right;
      }
      if (/cleanup_operational_simulation_visits|schema cache|could not find the function|permission denied/i.test(message)) {
        return false;
      }
      throw new Error(`visits cleanup: ${message || "QA cleanup RPC failed"}`);
    }

    let cleanupRpcAvailable = true;
    for (const batch of chunks(customerIds, 4)) {
      if (await cleanupVisitBatch(batch)) continue;
      cleanupRpcAvailable = false;
      break;
    }
    if (!cleanupRpcAvailable) {
      visitsDeleted = await removeByIds("visits", "visits", "customer_id", customerIds, true);
    }
  }
'''
text = replace_once(text, old_visit_delete, new_visit_delete, "QA-only Visit cleanup RPC")

old_final = '''  if (visitsDeleted) {
    if (routeIds.length) await remove("routes", service.from("routes").delete().in("id", routeIds));
    if (jobIds.length) await remove("jobs", service.from("jobs").delete().in("id", jobIds));
    if (customerIds.length) {
      await remove("quotes", service.from("quotes").delete().in("customer_id", customerIds));
      await remove("properties", service.from("properties").delete().in("customer_id", customerIds));
      await remove("customers", service.from("customers").delete().in("id", customerIds));
    }
    if (employeeIds.length) await remove("employees", service.from("employees").delete().in("id", employeeIds));
    if (crewIds.length) await remove("crews", service.from("crews").delete().in("id", crewIds));
  } else {
    const archivedAt = new Date().toISOString();
    if (customerIds.length) await remove("archive customers", service.from("customers").update({ archived_at: archivedAt }).in("id", customerIds));
    if (jobIds.length) await remove("deactivate jobs", service.from("jobs").update({ active: false }).in("id", jobIds));
    if (employeeIds.length) await remove("deactivate employees", service.from("employees").update({ active: false }).in("id", employeeIds));
    if (crewIds.length) await remove("deactivate crews", service.from("crews").update({ active: false }).in("id", crewIds));
    if (profileIds.length) await remove("deactivate profiles", service.from("profiles").update({ active: false }).in("id", profileIds));
  }'''
new_final = '''  if (visitsDeleted) {
    if (routeIds.length) await removeByIds("routes", "routes", "id", routeIds);
    if (jobIds.length) await removeByIds("jobs", "jobs", "id", jobIds);
    if (customerIds.length) {
      await removeByIds("quotes", "quotes", "customer_id", customerIds);
      await removeByIds("properties", "properties", "customer_id", customerIds);
      await removeByIds("customers", "customers", "id", customerIds);
    }
    if (employeeIds.length) await removeByIds("employees", "employees", "id", employeeIds);
    if (crewIds.length) await removeByIds("crews", "crews", "id", crewIds);
  } else {
    const archivedAt = new Date().toISOString();
    if (customerIds.length) await updateByIds("archive customers", "customers", { archived_at: archivedAt }, "id", customerIds);
    if (jobIds.length) await updateByIds("deactivate jobs", "jobs", { active: false }, "id", jobIds);
    if (employeeIds.length) await updateByIds("deactivate employees", "employees", { active: false }, "id", employeeIds);
    if (crewIds.length) await updateByIds("deactivate crews", "crews", { active: false }, "id", crewIds);
    if (profileIds.length) await updateByIds("deactivate profiles", "profiles", { active: false }, "id", profileIds);
  }'''
text = replace_once(text, old_final, new_final, "bounded simulator final cleanup")
simulator_path.write_text(text)


# Employee Mobile / canonical Route: older deployments expose the safe one-way
# sync_visit_route_order_for_route helper but may not yet grant service_role on
# sync_canonical_route_stops_v2. Prefer the transaction-level helper before the
# old two-phase compatibility path.
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


# Legacy feedback RPC writes the review and rebuilds the Customer board in one
# statement. A canceled PostgreSQL statement is transactional, so on SQLSTATE
# 57014 use the existing authenticated server-action fallback and reload the board
# separately. No timeout is changed.
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
