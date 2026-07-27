import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { getEmployeeProfile } from "@/lib/storage";

export type EmployeeOperationalIdentity = {
  name: string;
  crew: string;
  employeeId?: string | null;
  crewId?: string | null;
  routeStartAddress?: string | null;
};

function firstCrew(value: unknown): { id?: string; name?: string } | null {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === "object" ? value as { id?: string; name?: string } : null;
}

function cleanFallbackCrew(value?: string) {
  const crew = String(value || "").trim();
  return /^Crew\s+[A-C]$/i.test(crew) ? "" : crew;
}

export async function loadEmployeeOperationalIdentity(): Promise<EmployeeOperationalIdentity> {
  const local = getEmployeeProfile();
  const fallback = {
    name: local.name || "Employee",
    crew: cleanFallbackCrew(local.crew),
    employeeId: null,
    crewId: null,
    routeStartAddress: local.defaultAddress || null,
  };
  if (!isSupabaseConfigured()) return fallback;

  try {
    const supabase = getSupabaseBrowserClient() as any;
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user?.id) return fallback;

    const select = "id,full_name,email,crew_id,profile_id,address_line1,route_start_address,crews(id,name)";
    let { data: employee, error } = await supabase
      .from("employees")
      .select(select)
      .eq("profile_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if ((!employee || error) && user.email) {
      const byEmail = await supabase
        .from("employees")
        .select(select)
        .ilike("email", user.email.trim())
        .eq("active", true)
        .maybeSingle();
      employee = byEmail.data;
      error = byEmail.error;

      if (employee && !employee.profile_id) {
        await supabase.from("employees").update({ profile_id: user.id }).eq("id", employee.id).is("profile_id", null);
      }
    }

    if (error || !employee) return fallback;
    const crew = firstCrew(employee.crews);
    return {
      name: employee.full_name || fallback.name,
      crew: crew?.name || fallback.crew,
      employeeId: employee.id || null,
      crewId: employee.crew_id || crew?.id || null,
      routeStartAddress: employee.route_start_address || employee.address_line1 || fallback.routeStartAddress,
    };
  } catch {
    return fallback;
  }
}
