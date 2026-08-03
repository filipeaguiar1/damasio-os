from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))

replace_once(
    "lib/routes/canonicalRouteSnapshot.ts",
    '''async function accessToken() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token || storedAccessToken();
  if (token) return token as string;
  if (error) throw new Error(error.message);

  const refreshed = await supabase.auth.refreshSession();
  const refreshedToken = refreshed.data?.session?.access_token || storedAccessToken();
  if (!refreshedToken) throw new Error("Your session expired. Sign in again.");
  return refreshedToken as string;
}''',
    '''async function accessToken() {
  // The browser session is already persisted by Supabase. Read it synchronously
  // before asking the SDK to acquire its internal auth lock; this prevents route
  // rendering from waiting behind a second tab or the mobile surface.
  const persisted = storedAccessToken();
  if (persisted) return persisted;

  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token || storedAccessToken();
  if (token) return token as string;
  if (error) throw new Error(error.message);

  const refreshed = await supabase.auth.refreshSession();
  const refreshedToken = refreshed.data?.session?.access_token || storedAccessToken();
  if (!refreshedToken) throw new Error("Your session expired. Sign in again.");
  return refreshedToken as string;
}''',
)

Path("lib/services/employeeIdentityService.ts").write_text('''import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
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
  return /^Crew\\s+[A-C]$/i.test(crew) ? "" : crew;
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
''')

replace_once(
    "app/api/mobile/employee/bootstrap/route.ts",
    '''    const select="id,profile_id,company_id,organization_id,full_name,email,crew_id,active";
    let{data:employee,error:employeeError}=await client.from("employees").select(select).eq("profile_id",user.id).eq("active",true).maybeSingle();
    if(employeeError)throw new Error(employeeError.message);''',
    '''    const select="id,profile_id,company_id,organization_id,full_name,email,crew_id,address_line1,route_start_address,active,created_at,crews(id,name)";
    const employeeRows=await client.from("employees").select(select).eq("profile_id",user.id).eq("active",true).order("created_at",{ascending:false}).limit(20);
    if(employeeRows.error)throw new Error(employeeRows.error.message);
    let employee=(employeeRows.data||[]).find((candidate:any)=>Boolean(candidate.crew_id))||employeeRows.data?.[0]||null;''',
)
replace_once(
    "app/api/mobile/employee/bootstrap/route.ts",
    '''      employee=result.data?.[0]||null;''',
    '''      employee=(result.data||[]).find((candidate:any)=>Boolean(candidate.crew_id))||result.data?.[0]||null;''',
)
replace_once(
    "app/api/mobile/employee/bootstrap/route.ts",
    '''      employee:{id:employee.id,profileId:user.id,crewId:employee.crew_id||null,name:employee.full_name,email:normalizedEmail},''',
    '''      employee:{
        id:employee.id,
        profileId:user.id,
        crewId:employee.crew_id||null,
        crewName:(Array.isArray(employee.crews)?employee.crews[0]:employee.crews)?.name||null,
        name:employee.full_name,
        email:normalizedEmail,
        routeStartAddress:employee.route_start_address||employee.address_line1||null,
      },''',
)
