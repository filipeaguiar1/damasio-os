import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  let administrativeRpcCandidates: string[] = [];
  let rpcInspectionError: string | null = null;

  if (projectUrl && serviceRoleKey) {
    try {
      const response = await fetch(`${projectUrl}/rest/v1/`, {
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          accept: "application/openapi+json",
        },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`OpenAPI ${response.status}`);
      const schema = await response.json() as { paths?: Record<string, unknown> };
      administrativeRpcCandidates = Object.keys(schema.paths || {})
        .filter(path => path.startsWith("/rpc/"))
        .map(path => path.slice(5))
        .filter(name => /(sql|query|exec|database|migration|admin)/i.test(name))
        .sort();
    } catch (error) {
      rpcInspectionError = error instanceof Error ? error.message : "RPC inspection failed.";
    }
  }

  return NextResponse.json({
    hasSupabaseManagementToken: Boolean(
      process.env.SUPABASE_ACCESS_TOKEN
      || process.env.SUPABASE_MANAGEMENT_ACCESS_TOKEN,
    ),
    hasSupabaseServiceRoleKey: Boolean(serviceRoleKey),
    hasSupabaseProjectUrl: Boolean(projectUrl),
    hasDatabaseConnectionUrl: Boolean(
      process.env.DATABASE_URL
      || process.env.POSTGRES_URL
      || process.env.SUPABASE_DB_URL
      || process.env.DIRECT_URL,
    ),
    administrativeRpcCandidates,
    rpcInspectionError,
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
