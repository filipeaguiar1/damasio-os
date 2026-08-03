from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    file = Path(path)
    text = file.read_text()
    begin = text.find(start)
    finish = text.find(end, begin)
    if begin < 0 or finish < 0:
        raise RuntimeError(f"{path}: replacement markers not found")
    file.write_text(text[:begin] + replacement + text[finish:])


new_ensure_employees = '''async function ensureEmployees(service: any, companyId: string) {
  const profilesResult = await service
    .from("profiles")
    .select("id,full_name,email,address_line1,route_start_address,active")
    .eq("role", "employee")
    .eq("active", true)
    .or(companyFilter(companyId))
    .order("full_name");

  if (profilesResult.error) throw new Error(profilesResult.error.message);

  const employeeResult = await service
    .from("employees")
    .select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active,created_at")
    .eq("active", true)
    .or(companyFilter(companyId))
    .order("created_at", { ascending: false });

  if (employeeResult.error) throw new Error(employeeResult.error.message);

  const byProfile = new Map<string, any[]>();
  for (const row of employeeResult.data || []) {
    if (!row.profile_id) continue;
    const aliases = byProfile.get(String(row.profile_id)) || [];
    aliases.push(row);
    byProfile.set(String(row.profile_id), aliases);
  }

  const employees: any[] = [];
  for (const profile of profilesResult.data || []) {
    let aliases = byProfile.get(String(profile.id)) || [];
    let employee = aliases[0] || null;

    // Old demo logins must never become operational Employees, Crews or Route markers.
    if (isDemoIdentity(profile, employee)) continue;

    if (!employee) {
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

    const employeeIds = [...new Set(
      [...aliases.map(alias => String(alias.id || "")), String(employee.id || "")].filter(Boolean),
    )];
    const crewIds = [...new Set(
      [...aliases.map(alias => String(alias.crew_id || "")), String(employee.crew_id || "")].filter(Boolean),
    )];

    employees.push({
      id: profile.id,
      profileId: profile.id,
      employeeId: employee.id,
      crewId: employee.crew_id,
      employeeIds,
      crewIds,
      name: profile.full_name || employee.full_name || "Employee",
      email: profile.email || employee.email || "",
      routeStartAddress:
        profile.route_start_address
        || profile.address_line1
        || employee.route_start_address
        || employee.address_line1
        || null,
    });
  }

  return employees;
}
'''

replace_between(
    "app/api/admin/routes/route.ts",
    "async function ensureEmployees(service: any, companyId: string) {",
    "\nasync function canonicalJobs(service: any, user: any, companyId: string) {",
    new_ensure_employees,
)

replace_once(
    "app/api/admin/routes/route.ts",
    '''  const employeeIds = new Set(employees.map(employee => employee.employeeId).filter(Boolean));
  const crewIds = new Set(employees.map(employee => employee.crewId).filter(Boolean));''',
    '''  const employeeIds = new Set(employees.flatMap(employee =>
    employee.employeeIds?.length ? employee.employeeIds : [employee.employeeId]).filter(Boolean));
  const crewIds = new Set(employees.flatMap(employee =>
    employee.crewIds?.length ? employee.crewIds : [employee.crewId]).filter(Boolean));''',
)

for path in ["components/admin/OfficialRoutePlanMap.tsx", "components/admin/RouteStudio.tsx"]:
    replace_once(
        path,
        '''type RouteEmployee = {
  id: string;
  employeeId: string | null;
  crewId: string;
  name: string;
  email: string;
  routeStartAddress: string | null;
};''',
        '''type RouteEmployee = {
  id: string;
  employeeId: string | null;
  crewId: string;
  employeeIds?: string[];
  crewIds?: string[];
  name: string;
  email: string;
  routeStartAddress: string | null;
};''',
    )

replace_once(
    "app/mobile/admin/routes/page.tsx",
    '''type RouteEmployee = {
  id: string;
  employeeId: string;
  crewId: string;
  name: string;
  email: string;
  routeStartAddress: string | null;
};''',
    '''type RouteEmployee = {
  id: string;
  employeeId: string;
  crewId: string;
  employeeIds?: string[];
  crewIds?: string[];
  name: string;
  email: string;
  routeStartAddress: string | null;
};''',
)

replace_once(
    "components/admin/OfficialRouteStatus.tsx",
    'type RouteEmployee = { id: string; employeeId: string | null; crewId: string; name: string };',
    'type RouteEmployee = { id: string; employeeId: string | null; crewId: string; employeeIds?: string[]; crewIds?: string[]; name: string };',
)

replace_once(
    "components/admin/OfficialRoutePlanMap.tsx",
    '  const selectedIdentity = selectedEmployee ? { id: selectedEmployee.employeeId || selectedEmployee.id, crewId: selectedEmployee.crewId } : null;',
    '  const selectedIdentity = selectedEmployee ? { id: selectedEmployee.employeeId || selectedEmployee.id, crewId: selectedEmployee.crewId, employeeIds: selectedEmployee.employeeIds, crewIds: selectedEmployee.crewIds } : null;',
)
replace_once(
    "components/admin/OfficialRoutePlanMap.tsx",
    '      const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId };',
    '      const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId, employeeIds: employee.employeeIds, crewIds: employee.crewIds };',
)
replace_once(
    "components/admin/OfficialRoutePlanMap.tsx",
    '      const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId };',
    '      const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId, employeeIds: employee.employeeIds, crewIds: employee.crewIds };',
)

replace_once(
    "components/admin/RouteStudio.tsx",
    '''  const sourceIdentity = sourceEmployee
    ? { id: sourceEmployee.employeeId || sourceEmployee.id, crewId: sourceEmployee.crewId }
    : null;''',
    '''  const sourceIdentity = sourceEmployee
    ? { id: sourceEmployee.employeeId || sourceEmployee.id, crewId: sourceEmployee.crewId, employeeIds: sourceEmployee.employeeIds, crewIds: sourceEmployee.crewIds }
    : null;''',
)

replace_once(
    "app/mobile/admin/routes/page.tsx",
    '    const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId };',
    '    const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId, employeeIds: employee.employeeIds, crewIds: employee.crewIds };',
)

replace_once(
    "components/admin/OfficialRouteStatus.tsx",
    '    const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId };',
    '    const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId, employeeIds: employee.employeeIds, crewIds: employee.crewIds };',
)
