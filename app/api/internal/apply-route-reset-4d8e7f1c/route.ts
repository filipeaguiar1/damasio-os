import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resetCompanyRouteOwnership } from "@/lib/routes/resetCompanyRouteOwnership";

export const dynamic = "force-dynamic";

const COMPANY_ID = "5a72fc1b-81b8-40bf-86f6-3bd98c1dc4b8";
const CONFIRMATION = "reset-26-houses-7a31c9e4";

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceRole) throw new Error("Supabase access is unavailable.");
  return { url, anon, serviceRole };
}

function serviceClient() {
  const { url, serviceRole } = config();
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function authenticatedAdminClient(service: any) {
  const { url, anon } = config();
  const profile = await service
    .from("profiles")
    .select("id,email,role,active")
    .eq("company_id", COMPANY_ID)
    .eq("role", "admin")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (profile.error || !profile.data?.email) {
    throw new Error(profile.error?.message || "No active Admin profile was found for the company.");
  }

  const generated = await service.auth.admin.generateLink({
    type: "magiclink",
    email: String(profile.data.email),
  });
  if (generated.error) throw new Error(generated.error.message);
  const tokenHash = (generated.data as any)?.properties?.hashed_token;
  if (!tokenHash) throw new Error("Admin authorization token could not be generated.");

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
  const verified = await authClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verified.error || !verified.data.session?.access_token) {
    throw new Error(verified.error?.message || "Admin authorization could not be verified.");
  }

  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${verified.data.session.access_token}` } },
  }) as any;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("confirm") !== CONFIRMATION) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const service = serviceClient();
    const jobs = await service
      .from("jobs")
      .select("id")
      .eq("active", true)
      .or(`company_id.eq.${COMPANY_ID},organization_id.eq.${COMPANY_ID}`);
    if (jobs.error) throw new Error(jobs.error.message);

    const admin = await authenticatedAdminClient(service);
    let rpcUnassignedCount = 0;
    for (const job of jobs.data || []) {
      const result = await admin.rpc("assign_job_to_crew", {
        p_job_id: job.id,
        p_crew_id: null,
      });
      if (result.error) throw new Error(`Job ${job.id}: ${result.error.message}`);
      rpcUnassignedCount += 1;
    }

    const result = await resetCompanyRouteOwnership(service, COMPANY_ID, {
      cleanupDemoIdentities: true,
    });
    return NextResponse.json({ applied: true, rpcUnassignedCount, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reset failed." },
      { status: 400 },
    );
  }
}
