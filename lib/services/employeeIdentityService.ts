import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { getEmployeeProfile } from "@/lib/storage";

export type EmployeeOperationalIdentity = { name: string; crew: string };

export async function loadEmployeeOperationalIdentity(): Promise<EmployeeOperationalIdentity> {
  const local = getEmployeeProfile();
  const fallback = { name: local.name || "Employee", crew: local.crew || "Crew A" };
  if (!isSupabaseConfigured()) return fallback;
  try {
    const supabase = getSupabaseBrowserClient() as any;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) return fallback;
    const { data, error } = await supabase.from("employees").select("full_name,crews(name)").eq("profile_id", auth.user.id).eq("active", true).maybeSingle();
    if (error || !data) return fallback;
    const crewRecord = Array.isArray(data.crews) ? data.crews[0] : data.crews;
    return { name: data.full_name || fallback.name, crew: crewRecord?.name || fallback.crew };
  } catch {
    return fallback;
  }
}
