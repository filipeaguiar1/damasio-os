from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "app/api/admin/operational-simulator/route.ts",
    '''  async function remove(label: string, operation: PromiseLike<{ error?: { message?: string } | null }>, optional = false) {
    const result = await operation;
    if (!result.error) return;
    const message = result.error.message || "cleanup failed";
    if (optional && (missingColumn(message) || /permission denied/i.test(message))) {
      console.warn(`operational-simulator cleanup skipped ${label}: ${message}`);
      return;
    }
    throw new Error(`${label}: ${message}`);
  }''',
    '''  async function remove(label: string, operation: PromiseLike<{ error?: { message?: string } | null }>, optional = false) {
    const result = await operation;
    if (!result.error) return true;
    const message = result.error.message || "cleanup failed";
    if (optional && (missingColumn(message) || /permission denied/i.test(message))) {
      console.warn(`operational-simulator cleanup skipped ${label}: ${message}`);
      return false;
    }
    throw new Error(`${label}: ${message}`);
  }''',
)

replace_once(
    "app/api/admin/operational-simulator/route.ts",
    '''  if (customerIds.length) {
    await remove("invoices", service.from("invoices").delete().in("customer_id", customerIds));
    await remove("visits", service.from("visits").delete().in("customer_id", customerIds));
  }
  if (routeIds.length) await remove("routes", service.from("routes").delete().in("id", routeIds));
  if (jobIds.length) await remove("jobs", service.from("jobs").delete().in("id", jobIds));
  if (customerIds.length) {
    await remove("quotes", service.from("quotes").delete().in("customer_id", customerIds));
    await remove("properties", service.from("properties").delete().in("customer_id", customerIds));
    await remove("customers", service.from("customers").delete().in("id", customerIds));
  }
  if (employeeIds.length) await remove("employees", service.from("employees").delete().in("id", employeeIds));
  if (crewIds.length) await remove("crews", service.from("crews").delete().in("id", crewIds));''',
    '''  let visitsDeleted = true;
  if (customerIds.length) {
    await remove("invoices", service.from("invoices").delete().in("customer_id", customerIds));
    visitsDeleted = await remove("visits", service.from("visits").delete().in("customer_id", customerIds), true);
  }

  if (visitsDeleted) {
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
  }''',
)

replace_once(
    "app/api/admin/routes/route.ts",
    '.select("id,job_id,route_id,crew_id,assigned_employee_id,customer_id,property_id,scheduled_date,status,route_order,started_at,finished_at,duration_seconds,created_at,customers(full_name),properties(address_line1,city,province,postal_code),jobs(service_name),employees(full_name)")',
    '.select("id,job_id,route_id,crew_id,assigned_employee_id,customer_id,property_id,scheduled_date,status,route_order,started_at,finished_at,duration_seconds,created_at,customers(full_name,archived_at),properties(address_line1,city,province,postal_code),jobs(service_name),employees(full_name)")',
)

replace_once(
    "app/api/admin/routes/route.ts",
    '''    const employee = (Array.isArray(row.employees) ? row.employees[0] : row.employees)?.full_name || null;

    // Legacy demo Visits are not operational work and must not reappear in Route Plan/Status.
    if (isDemoLabel(employee)) return [];''',
    '''    const employee = (Array.isArray(row.employees) ? row.employees[0] : row.employees)?.full_name || null;
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;

    // Legacy demo and archived simulation Visits are not operational work.
    if (isDemoLabel(employee) || customer?.archived_at) return [];''',
)

replace_once(
    "tests/operational-simulator.spec.ts",
    'await expect(admin.getByText(/simulation customers/i)).toBeVisible({ timeout: 60_000 });',
    'await expect(admin.locator(".payment-message")).toContainText(/simulation customers.*removed/i, { timeout: 60_000 });',
)

replace_once(
    "tests/canonical-route-sync.spec.ts",
    '''  await authRequest(adminDesktop, "/api/admin/operational-simulator", {
    method: "POST",
    body: { action: "remove" },
  }).catch(() => undefined);
  const simulation = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator", {''',
    '''  const removal = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator", {
    method: "POST",
    body: { action: "remove" },
  });
  expect(removal.removed).toBe(true);
  await expect.poll(async () => {
    const result = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator");
    return Boolean(result.status?.exists);
  }, { timeout: 60_000 }).toBe(false);
  const simulation = await authRequest<any>(adminDesktop, "/api/admin/operational-simulator", {''',
)

print("Route soft-cleanup patch applied.")
