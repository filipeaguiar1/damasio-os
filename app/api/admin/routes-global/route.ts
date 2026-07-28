import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET as legacyGet, POST as legacyPost } from "@/app/api/admin/routes/route";
import { listOperationalCompanyEmployees } from "@/lib/employees/operationalEmployeeDirectory";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Operational Employee directory is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

async function companyContext(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");

  const service = serviceClient();
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Admin session expired. Sign in again.");

  const { data: profile, error } = await service
    .from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.user.id)
    .single();

  if (error || !profile?.active || !["admin", "manager"].includes(profile.role)) {
    throw new Error("Only an active company Admin can load operational Employees.");
  }

  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service, companyId };
}

export async function GET(request: NextRequest) {
  try {
    const [{ service, companyId }, legacyResponse] = await Promise.all([
      companyContext(request),
      legacyGet(request),
    ]);

    const payload = await legacyResponse.json();
    if (!legacyResponse.ok) {
      return NextResponse.json(payload, { status: legacyResponse.status });
    }

    const employees = await listOperationalCompanyEmployees(service, companyId);
    const employeeIds = new Set(employees.map(employee => employee.employeeId));
    const crewIds = new Set(employees.map(employee => employee.crewId));
    const previousIssues = Array.isArray(payload.health?.issues) ? payload.health.issues : [];
    const issues = previousIssues.filter((issue: any) => {
      const missing = Array.isArray(issue?.missing) ? issue.missing : [];
      if (!missing.includes("inactiveEmployeeId") && !missing.includes("inactiveCrewId")) return true;
      const visit = (payload.board?.visits || []).find((item: any) => item.id === issue.visitId);
      if (!visit) return true;
      return (visit.employeeId && !employeeIds.has(visit.employeeId))
        || (visit.crewId && !crewIds.has(visit.crewId));
    });

    return NextResponse.json({
      ...payload,
      employees,
      employeeDirectorySource: "profiles+employees",
      health: {
        ...(payload.health || {}),
        healthy: issues.length === 0,
        issueCount: issues.length,
        issues,
      },
      board: {
        ...(payload.board || {}),
        crews: employees.map(employee => ({
          id: employee.crewId,
          name: employee.name,
          active: true,
          createdAt: "",
        })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Operational Employees could not be loaded." },
      { status: 401 },
    );
  }
}

export async function POST(request: NextRequest) {
  return legacyPost(request);
}
