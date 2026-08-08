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

function storedAccessToken() {
  if (typeof window === "undefined") return null;
  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) || "null");
      const token = stored?.access_token || stored?.currentSession?.access_token;
      if (typeof token === "string" && token.length > 20) return token;
    } catch {
      // Ignore malformed unrelated browser storage.
    }
  }
  return null;
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

  // Use the same service-backed bootstrap as mobile. It resolves legacy duplicate
  // Employee rows and does not depend on the browser SDK auth lock.
  const persistedToken = storedAccessToken();
  if (persistedToken) {
    try {
      const response = await fetch("/api/mobile/employee/bootstrap", {
        method: "POST",
        headers: { authorization: `Bearer ${persistedToken}` },
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.employee?.id) {
        return {
          name: result.employee.name || fallback.name,
          crew: result.employee.crewName || fallback.crew,
          employeeId: result.employee.id,
          crewId: result.employee.crewId || null,
          routeStartAddress: result.employee.routeStartAddress || fallback.routeStartAddress,
        };
      }
    } catch {
      // Fall through to the browser query for offline/older deployments.
    }
  }

  try {
    const supabase = getSupabaseBrowserClient() as any;
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user?.id) return fallback;

    const select = "id,full_name,email,crew_id,profile_id,address_line1,route_start_address,created_at,crews(id,name)";
    const byProfile = await supabase
      .from("employees")
      .select(select)
      .eq("profile_id", user.id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(20);
    let error = byProfile.error;
    let employee = (byProfile.data || []).find((candidate: any) => Boolean(candidate.crew_id))
      || byProfile.data?.[0]
      || null;

    if ((!employee || error) && user.email) {
      const byEmail = await supabase
        .from("employees")
        .select(select)
        .ilike("email", user.email.trim())
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(20);
      employee = (byEmail.data || []).find((candidate: any) => Boolean(candidate.crew_id))
        || byEmail.data?.[0]
        || null;
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
