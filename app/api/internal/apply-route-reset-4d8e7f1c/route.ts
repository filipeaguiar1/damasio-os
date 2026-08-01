import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resetCompanyRouteOwnership } from "@/lib/routes/resetCompanyRouteOwnership";

export const dynamic = "force-dynamic";

const COMPANY_ID = "5a72fc1b-81b8-40bf-86f6-3bd98c1dc4b8";
const CONFIRMATION = "reset-26-houses-7a31c9e4";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service access is unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("confirm") !== CONFIRMATION) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const result = await resetCompanyRouteOwnership(serviceClient(), COMPANY_ID, {
      cleanupDemoIdentities: true,
    });
    return NextResponse.json({ applied: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reset failed." },
      { status: 400 },
    );
  }
}
