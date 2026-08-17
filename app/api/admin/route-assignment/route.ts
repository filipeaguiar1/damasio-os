import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Route assignment is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}
function userClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase browser access is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } }) as any;
}
async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");
  const service = serviceClient();
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Admin session expired. Sign in again.");
  const { data: profile, error } = await service.from("profiles").select("id,role,active,company_id,organization_id").eq("id", auth.user.id).single();
  if (error || !profile?.active || !["admin", "manager"].includes(profile.role)) throw new Error("Only an active company Admin can change assignments.");
  return { user: userClient(token), service };
}
function assignmentError(message?: string) {
  const value = message || "Canonical assignment failed.";
  if (/move_canonical_visits|transfer_customer_jobs_without_date|schema cache|could not find the function/i.test(value)) return new Error("A required canonical route assignment migration is pending.");
  return new Error(value);
}
async function capacityWarnings(service:any, crewId:string, employeeId:string){
  const { data: profile } = await service.from("profiles").select("daily_route_capacity").eq("id", employeeId).maybeSingle();
  const capacity = Math.max(1, Number(profile?.daily_route_capacity || 16));
  const start = new Date(); const end = new Date(); end.setDate(end.getDate()+60);
  const { data: visits } = await service.from("visits").select("scheduled_date").eq("crew_id", crewId).eq("status","scheduled").gte("scheduled_date", start.toISOString().slice(0,10)).lte("scheduled_date", end.toISOString().slice(0,10));
  const counts = new Map<string,number>(); for(const row of visits||[]){const d=String(row.scheduled_date||"");counts.set(d,(counts.get(d)||0)+1);} return [...counts].filter(([,count])=>count>capacity).map(([date,count])=>({date,count,capacity}));
}

export async function POST(request: NextRequest) {
  try {
    const { user, service } = await requireAdmin(request);
    const body = await request.json() as { mode?: "temporary" | "permanent" | "client_transfer"; visitIds?: string[]; jobIds?: string[]; employeeId?: string; crewId?: string };
    const mode = body.mode === "client_transfer" ? "client_transfer" : body.mode === "permanent" ? "permanent" : "temporary";
    const employeeId = String(body.employeeId || ""); const crewId = String(body.crewId || "");
    if (!employeeId || !crewId) throw new Error("Choose the destination Employee.");

    if (mode === "client_transfer") {
      const jobIds = [...new Set((body.jobIds || []).map(String).filter(Boolean))];
      if (!jobIds.length) throw new Error("Select at least one Customer Job.");
      const result = await user.rpc("transfer_customer_jobs_without_date", {
        p_job_ids: jobIds,
        p_employee_id: employeeId,
        p_crew_id: crewId,
      });
      if (result.error) throw assignmentError(result.error.message);
      const warnings = await capacityWarnings(service, crewId, employeeId);
      return NextResponse.json({ ...(result.data || {}), capacityWarnings: warnings });
    }

    const visitIds = [...new Set((body.visitIds || []).map(String).filter(Boolean))]; if (!visitIds.length) throw new Error("Select at least one scheduled Visit.");
    const result = await user.rpc("move_canonical_visits", { p_visit_ids: visitIds, p_employee_id: employeeId, p_crew_id: crewId, p_mode: mode }); if (result.error) throw assignmentError(result.error.message);
    const warnings = mode === "permanent" ? await capacityWarnings(service, crewId, employeeId) : [];
    return NextResponse.json({ ...(result.data || {}), capacityWarnings: warnings });
  } catch (error) {
    console.error("admin-route-assignment-post", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Route assignment failed." }, { status: 400 });
  }
}
