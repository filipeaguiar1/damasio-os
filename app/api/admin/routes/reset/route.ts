import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resetCompanyRouteOwnership } from "@/lib/routes/resetCompanyRouteOwnership";
import { hasManagerPermission } from "@/lib/auth/managerPermissions";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Route reset is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

function userClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase browser access is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;
}

async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");

  const service = serviceClient();
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) {
    throw new Error("Your Admin session expired. Sign in again.");
  }

  const { data: profile, error } = await service
    .from("profiles")
    .select("id,role,active,company_id,organization_id,manager_permissions")
    .eq("id", auth.user.id)
    .single();
  if (error || !profile?.active || !["admin", "manager"].includes(profile.role)) {
    throw new Error("Only an active company Admin can reset route ownership.");
  }
  if (profile.role === "manager" && !hasManagerPermission(profile.manager_permissions, "routes", "manage")) {
    throw new Error("Manager Routes management permission is required.");
  }

  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return {
    user: userClient(token),
    companyId: String(companyId),
  };
}

export async function POST(request: NextRequest) {
  try {
    const { user, companyId } = await requireAdmin(request);
    const body = await request.json().catch(() => ({})) as {
      confirmation?: string;
    };
    if (String(body.confirmation || "").trim().toUpperCase() !== "RESET ROUTES") {
      throw new Error("Type RESET ROUTES to confirm this company route reset.");
    }

    const result = await resetCompanyRouteOwnership(user, companyId, {
      cleanupDemoIdentities: true,
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
