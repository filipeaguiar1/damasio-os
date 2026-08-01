import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const COMPANY_ID = "5a72fc1b-81b8-40bf-86f6-3bd98c1dc4b8";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service access is unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function probe(service: any, table: string) {
  const result = await service.from(table).select("*").limit(3);
  return result.error
    ? { table, error: result.error.message }
    : { table, rows: result.data || [] };
}

export async function GET() {
  try {
    const service = serviceClient();
    const [jobs, employees, profiles, crews, routes, visits, ...assignmentTables] = await Promise.all([
      service.from("jobs").select("*").or(`company_id.eq.${COMPANY_ID},organization_id.eq.${COMPANY_ID}`).limit(3),
      service.from("employees").select("*").or(`company_id.eq.${COMPANY_ID},organization_id.eq.${COMPANY_ID}`).order("created_at"),
      service.from("profiles").select("id,role,full_name,email,active,company_id,organization_id").or(`company_id.eq.${COMPANY_ID},organization_id.eq.${COMPANY_ID}`).order("full_name"),
      service.from("crews").select("*").or(`company_id.eq.${COMPANY_ID},organization_id.eq.${COMPANY_ID}`).order("created_at"),
      service.from("routes").select("*").or(`company_id.eq.${COMPANY_ID},organization_id.eq.${COMPANY_ID}`).order("route_date", { ascending: false }).limit(10),
      service.from("visits").select("id,job_id,route_id,crew_id,assigned_employee_id,scheduled_date,status,route_order").or(`company_id.eq.${COMPANY_ID},organization_id.eq.${COMPANY_ID}`).order("scheduled_date", { ascending: false }).limit(60),
      probe(service, "job_route_patterns"),
      probe(service, "job_crew_assignments"),
      probe(service, "job_assignments"),
      probe(service, "route_patterns"),
      probe(service, "recurring_job_routes"),
    ]);

    return NextResponse.json({
      companyId: COMPANY_ID,
      jobs: { error: jobs.error?.message || null, rows: jobs.data || [] },
      employees: { error: employees.error?.message || null, rows: employees.data || [] },
      profiles: { error: profiles.error?.message || null, rows: profiles.data || [] },
      crews: { error: crews.error?.message || null, rows: crews.data || [] },
      routes: { error: routes.error?.message || null, rows: routes.data || [] },
      visits: { error: visits.error?.message || null, rows: visits.data || [] },
      assignmentTables,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Diagnostic failed." }, { status: 500 });
  }
}
