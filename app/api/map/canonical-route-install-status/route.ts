import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  return NextResponse.json({
    hasSupabaseManagementToken: Boolean(
      process.env.SUPABASE_ACCESS_TOKEN
      || process.env.SUPABASE_MANAGEMENT_ACCESS_TOKEN,
    ),
    hasSupabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasSupabaseProjectUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
