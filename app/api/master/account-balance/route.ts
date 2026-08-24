import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

async function requireMaster(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Master balance database access is not configured.");

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");

  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;

  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");

  const { data: profile, error: profileError } = await authClient
    .from("profiles")
    .select("id,role,active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.role !== "master") {
    throw new Error("Only an active Master can view the platform balance.");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

export async function GET(request: NextRequest) {
  try {
    const db = await requireMaster(request);
    const [{ data: summary, error: summaryError }, { data: entries, error: entriesError }] = await Promise.all([
      db.rpc("master_balance_summary"),
      db.from("master_balance_entries")
        .select("id,payment_id,invoice_id,company_id,customer_id,stripe_payment_intent_id,stripe_charge_id,currency,gross_payment_cents,amount_cents,state,status_reason,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (summaryError) throw new Error(summaryError.message);
    if (entriesError) throw new Error(entriesError.message);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      currency: "cad",
      summary: summary || {
        availableCents: 0,
        disputedCents: 0,
        refundedCents: 0,
        reversedCents: 0,
        recordedCents: 0,
        entryCount: 0,
      },
      entries: entries || [],
    });
  } catch (error) {
    console.error("Master account balance failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Master account balance could not be loaded." },
      { status: 401 },
    );
  }
}
