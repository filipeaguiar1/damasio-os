from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise SystemExit(f"Expected anchor not found: {label}")
    return source.replace(old, new, 1)


route_path = Path("app/api/admin/routes/route.ts")
route = route_path.read_text(encoding="utf-8")

route = replace_once(
    route,
    "async function ensureEmployees(service: any, companyId: string) {",
    "async function readEmployees(service: any, companyId: string) {",
    "rename mutating employee reader",
)

old_employee_writes = '''    if (!employee) {
      const created = await service
        .from("employees")
        .insert({
          company_id: companyId,
          organization_id: companyId,
          profile_id: profile.id,
          full_name: profile.full_name,
          email: profile.email,
          address_line1: profile.address_line1,
          route_start_address: profile.route_start_address || profile.address_line1,
          active: true,
          invite_status: "sent",
        })
        .select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active")
        .single();

      if (created.error) throw new Error(created.error.message);
      employee = created.data;
      aliases = [employee];
    }

    if (!employee.crew_id) {
      const crew = await service
        .from("crews")
        .insert({
          company_id: companyId,
          organization_id: companyId,
          name: employee.full_name || profile.full_name || "Employee route",
          active: true,
        })
        .select("id")
        .single();

      if (crew.error) throw new Error(crew.error.message);

      const linked = await service
        .from("employees")
        .update({ crew_id: crew.data.id })
        .eq("id", employee.id);
      if (linked.error) throw new Error(linked.error.message);
      employee.crew_id = crew.data.id;
    }
'''
route = replace_once(
    route,
    old_employee_writes,
    '''    // GET is a read model. Employee/Crew creation belongs to the explicit lifecycle flow.
    if (!employee || !employee.crew_id) continue;
''',
    "remove GET employee and crew writes",
)

route = replace_once(
    route,
    '''  const propertyResult = await service
    .from("properties")
    .select("id,customer_id,address_line1,city,province,postal_code,property_notes")
    .in("customer_id", customerIds);''',
    '''  const propertyResult = await service
    .from("properties")
    .select("id,customer_id,address_line1,city,province,postal_code,property_notes")
    .in("customer_id", customerIds)
    .or(companyFilter(companyId));''',
    "tenant-scope properties",
)

old_job_writes = '''  const jobByProperty = new Map<string, any>();
  for (const job of jobs) {
    if (job.property_id && !jobByProperty.has(job.property_id)) jobByProperty.set(job.property_id, job);
  }

  for (const property of properties) {
    if (!property.id || jobByProperty.has(property.id)) continue;
    const inserted = await service
      .from("jobs")
      .insert({
        organization_id: companyId,
        company_id: companyId,
        customer_id: property.customer_id,
        property_id: property.id,
        service_name: property.property_notes
          ?.split("\\n")[0]
          ?.replace(/^Service type:\\s*/i, "")
          || "Property Service",
        frequency: "one_time",
        active: true,
      })
      .select("id,customer_id,property_id,service_name,frequency,next_visit_date,recurrence_anchor_date,default_route_order,created_at,active")
      .single();

    if (inserted.error) throw new Error(inserted.error.message);
    jobs.push(inserted.data);
    jobByProperty.set(property.id, inserted.data);
  }

'''
route = replace_once(route, old_job_writes, "", "remove GET job writes")

route = replace_once(
    route,
    ".limit(routeDate ? 250 : 500);",
    ".limit(routeDate ? 250 : 100);",
    "bound compatibility route scan",
)

route = replace_once(
    route,
    "      ensureEmployees(service, companyId),",
    "      readEmployees(service, companyId),",
    "use read-only employee reader",
)

if '.from("employees")\n        .insert' in route or '.from("crews")\n        .insert' in route or '.from("jobs")\n      .insert' in route:
    raise SystemExit("GET route still contains a legacy auto-create writer")

route_path.write_text(route, encoding="utf-8")

mobile_path = Path("app/mobile/admin/routes/page.tsx")
mobile = mobile_path.read_text(encoding="utf-8")
mobile = replace_once(
    mobile,
    '      const result = await api("/api/admin/routes");',
    '      const result = await api(`/api/admin/routes?date=${encodeURIComponent(date)}`);',
    "mobile route date request",
)
mobile = replace_once(
    mobile,
    '''  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(false), 10_000);
    return () => window.clearInterval(timer);
  }, []);''',
    '''  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(false), 10_000);
    return () => window.clearInterval(timer);
  }, [date]);''',
    "mobile route refresh date dependency",
)
mobile_path.write_text(mobile, encoding="utf-8")
