export type OperationalEmployee = {
  id: string;
  profileId: string | null;
  employeeId: string;
  crewId: string;
  name: string;
  email: string;
  routeStartAddress: string | null;
};

export const OPERATIONAL_EMPLOYEE_DIRECTORY_SOURCE = "active-real-profile+employee" as const;

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function isDemoLabel(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized.startsWith("demo")
    || normalized.includes("sandbox-")
    || normalized.endsWith("@4everseasons.test")
    || normalized.endsWith("@example.com");
}

function isDemoIdentity(profile?: any, employee?: any) {
  return isDemoLabel(profile?.full_name)
    || isDemoLabel(profile?.email)
    || isDemoLabel(employee?.full_name)
    || isDemoLabel(employee?.email);
}

async function ensureCrew(service: any, companyId: string, profile: any, employee: any) {
  if (employee.crew_id) return employee;

  const crew = await service
    .from("crews")
    .insert({
      company_id: companyId,
      organization_id: companyId,
      name: profile?.full_name || employee.full_name || "Employee route",
      active: true,
    })
    .select("id")
    .single();
  if (crew.error) throw new Error(crew.error.message);

  const linked = await service
    .from("employees")
    .update({ crew_id: crew.data.id })
    .eq("id", employee.id)
    .select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active")
    .single();
  if (linked.error) throw new Error(linked.error.message);
  return linked.data;
}

async function createEmployeeFromProfile(service: any, companyId: string, profile: any) {
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
      invite_status: profile.invite_status || "accepted",
    })
    .select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active")
    .single();
  if (created.error) throw new Error(created.error.message);
  return created.data;
}

async function linkEmployeeByEmail(service: any, companyId: string, profile: any) {
  const email = String(profile.email || "").trim();
  if (!email) return null;

  const result = await service
    .from("employees")
    .select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active")
    .ilike("email", email)
    .eq("active", true)
    .or(companyFilter(companyId))
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data || isDemoIdentity(profile, result.data)) return null;

  if (result.data.profile_id !== profile.id) {
    const linked = await service
      .from("employees")
      .update({ profile_id: profile.id })
      .eq("id", result.data.id)
      .select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active")
      .single();
    if (linked.error) throw new Error(linked.error.message);
    return linked.data;
  }
  return result.data;
}

function toOperationalEmployee(profile: any, employee: any): OperationalEmployee {
  return {
    id: profile.id,
    profileId: profile.id,
    employeeId: employee.id,
    crewId: employee.crew_id,
    name: profile.full_name || employee.full_name || "Employee",
    email: profile.email || employee.email || "",
    routeStartAddress:
      profile.route_start_address
      || profile.address_line1
      || employee.route_start_address
      || employee.address_line1
      || null,
  };
}

export async function listOperationalCompanyEmployees(
  service: any,
  companyId: string,
): Promise<OperationalEmployee[]> {
  const [profilesResult, employeeResult] = await Promise.all([
    service
      .from("profiles")
      .select("id,role,full_name,email,address_line1,route_start_address,active,invite_status")
      .eq("role", "employee")
      .eq("active", true)
      .or(companyFilter(companyId)),
    service
      .from("employees")
      .select("id,profile_id,crew_id,full_name,email,address_line1,route_start_address,active")
      .eq("active", true)
      .or(companyFilter(companyId)),
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (employeeResult.error) throw new Error(employeeResult.error.message);

  const profiles: any[] = (profilesResult.data || []).filter((profile: any) => !isDemoIdentity(profile));
  const employeesByProfile = new Map<string, any>();
  for (const employee of employeeResult.data || []) {
    if (employee.profile_id && !isDemoIdentity(undefined, employee)) {
      employeesByProfile.set(String(employee.profile_id), employee);
    }
  }

  const directory: OperationalEmployee[] = [];
  for (const profile of profiles) {
    let employee = employeesByProfile.get(String(profile.id));
    if (!employee) employee = await linkEmployeeByEmail(service, companyId, profile);
    if (!employee) employee = await createEmployeeFromProfile(service, companyId, profile);
    if (!employee.active || isDemoIdentity(profile, employee)) continue;

    employee = await ensureCrew(service, companyId, profile, employee);
    directory.push(toOperationalEmployee(profile, employee));
  }

  return directory.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    || left.employeeId.localeCompare(right.employeeId));
}
