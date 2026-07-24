import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Master payouts are not configured.");
  return { url, anonKey, serviceKey };
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const { url, anonKey, serviceKey } = env();
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  }) as any;
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error: profileError } = await authClient.from("profiles").select("id,role,active").eq("id", auth.user.id).maybeSingle();
  if (profileError || !profile?.active || profile.role !== "master") throw new Error("Only an active Master can manage payouts.");
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  return { authClient, service, masterId: auth.user.id };
}

function failure(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Master payout request failed." }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { service } = await requireMaster(request);
    const companyId = request.nextUrl.searchParams.get("companyId") || "";
    const itemQuery = service
      .from("company_payout_items")
      .select("id,company_id,invoice_id,payment_id,job_id,visit_id,customer_id,property_id,amount_total,platform_fee,transfer_amount,status,hold_reason,eligible_at,created_at,approved_at,transferred_at")
      .order("created_at", { ascending: false })
      .limit(100);
    const batchQuery = service
      .from("company_payout_batches")
      .select("id,company_id,week_start,week_end,scheduled_payout_date,status,total_transfer_amount,approved_at,processed_at,created_at")
      .order("created_at", { ascending: false })
      .limit(40);
    if (companyId) {
      itemQuery.eq("company_id", companyId);
      batchQuery.eq("company_id", companyId);
    }
    const [items, batches, companies] = await Promise.all([
      itemQuery,
      batchQuery,
      service.from("organizations").select("id,name,stripe_connect_status,stripe_connected_account_id").is("deleted_at", null).order("name")
    ]);
    const schemaMissing = [items.error, batches.error].some(error => error?.message?.includes("company_payout"));
    if (schemaMissing) {
      return NextResponse.json({
        items: [],
        batches: [],
        companies: companies.data || [],
        warning: "Payout database migration is not applied yet. Run supabase/migrations/202607240001_stripe_connect_weekly_payouts.sql in Supabase SQL Editor."
      });
    }
    if (items.error) throw new Error(items.error.message);
    if (batches.error) throw new Error(batches.error.message);
    if (companies.error) throw new Error(companies.error.message);
    return NextResponse.json({ items: items.data || [], batches: batches.data || [], companies: companies.data || [] });
  } catch (error) {
    return failure(error, 401);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { authClient } = await requireMaster(request);
    const body = await request.json() as { companyId?: string; referenceDate?: string };
    const companyId = String(body.companyId || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(companyId)) throw new Error("Choose a valid company.");
    const referenceDate = body.referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(body.referenceDate) ? body.referenceDate : new Date().toISOString().slice(0, 10);
    const { data, error } = await authClient.rpc("generate_company_weekly_payout_batch", {
      p_company_id: companyId,
      p_reference_date: referenceDate
    });
    if (error?.message?.includes("generate_company_weekly_payout_batch")) {
      throw new Error("Payout database migration is not applied yet. Run supabase/migrations/202607240001_stripe_connect_weekly_payouts.sql in Supabase SQL Editor first.");
    }
    if (error) throw new Error(error.message);
    return NextResponse.json({ batchId: data, message: "Weekly payout batch generated." });
  } catch (error) {
    return failure(error, 400);
  }
}
