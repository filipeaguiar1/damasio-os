import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

function dbClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Payout reconciliation is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const db = dbClient();
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Master session expired. Sign in again.");
  const { data: profile, error } = await db.from("profiles").select("id,role,active").eq("id", auth.user.id).maybeSingle();
  if (error || !profile?.active || profile.role !== "master") throw new Error("Only an active Master can manage payout reconciliation holds.");
  return { db, masterId: String(auth.user.id) };
}

function fail(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Payout reconciliation request failed." }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { db } = await requireMaster(request);
    const { data, error } = await db.from("organizations")
      .select("id,name,stripe_connect_status,stripe_payout_reconciliation_hold,stripe_payout_reconciliation_note,stripe_payout_reconciled_at")
      .eq("stripe_payout_reconciliation_hold", true)
      .is("deleted_at", null)
      .order("name");
    if (error) throw new Error(error.message);
    return NextResponse.json({ holds: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payout reconciliation holds could not be loaded.";
    return fail(error, /session expired|sign in/i.test(message) ? 401 : /Only an active Master/i.test(message) ? 403 : 400);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = z.object({ companyId: z.string().uuid(), note: z.string().trim().min(8).max(500) }).strict().parse(await request.json());
    const { db, masterId } = await requireMaster(request);
    const { data: company, error: companyError } = await db.from("organizations")
      .select("id,name,stripe_payout_reconciliation_hold,stripe_payout_reconciliation_note")
      .eq("id", body.companyId)
      .maybeSingle();
    if (companyError || !company) throw new Error(companyError?.message || "Company not found.");
    if (!company.stripe_payout_reconciliation_hold) return NextResponse.json({ cleared: false, message: "This company has no active payout reconciliation hold." });

    // The database revalidates Master identity and refuses to clear a hold while any
    // customer refund still depends on Stripe transfer / payout reconciliation.
    const cleared = await db.rpc("clear_company_payout_reconciliation_hold", {
      p_company_id: body.companyId,
      p_master_id: masterId,
    });
    if (cleared.error) throw new Error(cleared.error.message);
    const audit = await db.from("master_audit_log").insert({
      master_profile_id: masterId,
      company_id: body.companyId,
      action: "payout.reconciliation_hold_cleared",
      entity_type: "organization",
      entity_id: body.companyId,
      details: { note: body.note, previous_note: company.stripe_payout_reconciliation_note || null },
    });
    if (audit.error) throw new Error(`Hold cleared but audit logging failed: ${audit.error.message}`);
    return NextResponse.json({ cleared: true, message: `${company.name || "Company"} withdrawals were unlocked after Master review.` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payout reconciliation hold could not be cleared.";
    const status = /session expired|sign in/i.test(message) ? 401
      : /Only an active Master/i.test(message) ? 403
      : /Cannot clear payout hold/i.test(message) ? 409
      : 400;
    return fail(error, status);
  }
}
