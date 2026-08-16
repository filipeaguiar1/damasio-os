import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Master authentication is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error } = await client.from("profiles")
    .select("id,role,active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error || !profile?.active || profile.role !== "master") {
    throw new Error("Only Master can manage platform leads.");
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireMaster(request);
    return NextResponse.json({
      error: "Separate platform registration has been retired. Use the canonical Quote response flow so Customer, company ownership and Quote state stay linked.",
      canonicalFlow: "quote_response",
    }, { status: 410 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Master access required." }, { status: 401 });
  }
}
