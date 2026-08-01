import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resetCompanyRouteOwnership } from "@/lib/routes/resetCompanyRouteOwnership";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Route reset is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireAdmin(request: NextRequest) {
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
    throw new Error("Only an active company Admin can reset route ownership.");
  }

  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service, companyId: String(companyId), actorProfileId: String(profile.id) };
}

export async function POST(request: NextRequest) {
  try {
    const { service, companyId, actorProfileId } = await requireAdmin(request);
    const body = await request.json().catch(() => ({})) as { confirmation?: string };
    if (String(body.confirmation || "").trim().toUpperCase() !== "RESET ROUTES") {
      throw new Error("Type RESET ROUTES to confirm this company route reset.");
    }

    const result = await resetCompanyRouteOwnership(service, companyId, {
      cleanupDemoIdentities: true,
    });

    await service.from("activity_log").insert({
      organization_id: companyId,
      company_id: companyId,
      actor_profile_id: actorProfileId,
      action: "route.ownership_reset",
      entity_type: "company",
      entity_id: companyId,
      details: "Admin reset permanent Job ownership and removable route Visits while preserving Customers, Properties and Jobs.",
      metadata: result,
    });

    return NextResponse.json({ reset: true, ...result });
  } catch (error) {
    console.error("admin-routes-reset", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Route reset failed." },
      { status: 400 },
    );
  }
}
