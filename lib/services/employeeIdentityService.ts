import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { readDemoSession } from "@/lib/auth/demoAuth";
import { getEmployeeProfile } from "@/lib/storage";

export type EmployeeOperationalIdentity = { name: string; crew: string };

export async function loadEmployeeOperationalIdentity(): Promise<EmployeeOperationalIdentity> {
  const local = getEmployeeProfile();
  const fallback = { name: local.name || "Employee", crew: local.crew || "Crew A" };
  if (readDemoSession() || !isSupabaseConfigured()) return fallback;

  const supabase = getSupabaseBrowserClient() as any;
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user?.id) {
    throw new Error("Your Employee session is invalid. Sign in again.");
  }

  const { data, error } = await supabase
    .from("employees")
    .select("full_name,company_id,crew_id,crews(name)")
    .eq("profile_id", auth.user.id)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`Employee identity could not be loaded: ${error.message}`);
  if (!data?.company_id) throw new Error("Your Employee account is not linked to a company.");
  if (!data?.crew_id) throw new Error("Your Employee account is not assigned to a crew.");

  const crewRecord = Array.isArray(data.crews) ? data.crews[0] : data.crews;
  if (!crewRecord?.name) throw new Error("Your assigned crew is unavailable.");
  return { name: data.full_name || "Employee", crew: crewRecord.name };
}
