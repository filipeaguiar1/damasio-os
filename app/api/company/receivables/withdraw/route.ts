import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function cadAvailable(balance: Stripe.Balance) {
  return balance.available
    .filter((row) => row.currency.toLowerCase() === "cad")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

async function context(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!url || !serviceKey || !stripeKey) throw new Error("Withdrawals are not configured.");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Company Admin.");
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.user.id).maybeSingle();
  if (profileError || !profile?.active || profile.role !== "admin") {
    throw new Error("Only the active Company Admin can withdraw company funds.");
  }
  const companyId = String(profile.company_id || profile.organization_id || "");
  const { data: company, error: companyError } = await db.from("organizations")
    .select("id,name,stripe_connected_account_id,stripe_connect_status,stripe_payout_schedule")
    .eq("id", companyId).maybeSingle();
  if (companyError || !company) throw new Error(companyError?.message || "Company not found.");
  if (company.stripe_connect_status !== "enabled" || !company.stripe_connected_account_id) {
    throw new Error("Stripe Connect payouts must be fully enabled before withdrawing funds.");
  }
  return { db, stripe: new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" }), profile, company };
}

export async function POST(request: NextRequest) {
  let reservedWithdrawalId = "";
  let db: any = null;
  try {
    const ctx = await context(request);
    db = ctx.db;
    const { stripe, profile, company } = ctx;
    const body = await request.json() as { amountCents?: number };
    const amountCents = Math.round(Number(body.amountCents || 0));
    if (!Number.isSafeInteger(amountCents) || amountCents < 100) {
      return fail("Enter a withdrawal of at least $1.00 CAD.", 400);
    }

    const balance = await stripe.balance.retrieve({ stripeAccount: company.stripe_connected_account_id });
    const stripeAvailableCents = cadAvailable(balance);
    if (amountCents > stripeAvailableCents) {
      return fail("The requested amount is greater than Stripe's currently available CAD balance.", 409);
    }

    const reserved = await db.rpc("reserve_company_withdrawal", {
      p_company_id: company.id,
      p_amount_cents: amountCents,
      p_requested_by: profile.id,
      p_system_generated: false,
    });
    if (reserved.error) return fail(reserved.error.message || "Available balance could not be reserved.", 409);
    reservedWithdrawalId = String(reserved.data || "");
    if (!reservedWithdrawalId) throw new Error("Withdrawal reservation was not created.");

    const stamp = await db.from("company_withdrawals").update({
      stripe_available_cents_at_request: stripeAvailableCents,
      updated_at: new Date().toISOString(),
    }).eq("id", reservedWithdrawalId);
    if (stamp.error) throw new Error(stamp.error.message);

    const payout = await stripe.payouts.create({
      amount: amountCents,
      currency: "cad",
      metadata: {
        withdrawalId: reservedWithdrawalId,
        companyId: company.id,
        requestedBy: profile.id,
        platform: "4ever-seasons",
      },
    }, {
      stripeAccount: company.stripe_connected_account_id,
      idempotencyKey: `company-withdrawal-${reservedWithdrawalId}`,
    });

    const arrival = payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null;
    const saved = await db.from("company_withdrawals").update({
      status: payout.status === "paid" ? "processing" : "processing",
      stripe_payout_id: payout.id,
      estimated_arrival_at: arrival,
      processed_at: new Date().toISOString(),
      failure_code: null,
      failure_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", reservedWithdrawalId);
    if (saved.error) throw new Error(saved.error.message);

    if (payout.status === "paid") {
      const complete = await db.rpc("complete_company_withdrawal", {
        p_withdrawal_id: reservedWithdrawalId,
        p_stripe_payout_id: payout.id,
      });
      if (complete.error) throw new Error(complete.error.message);
    }

    return NextResponse.json({
      ok: true,
      withdrawalId: reservedWithdrawalId,
      payoutId: payout.id,
      status: payout.status,
      amountCents,
      estimatedArrivalAt: arrival,
    });
  } catch (error) {
    if (reservedWithdrawalId && db) {
      const released = await db.rpc("release_company_withdrawal_reservation", {
        p_withdrawal_id: reservedWithdrawalId,
        p_failure_code: "stripe_payout_failed",
        p_failure_message: error instanceof Error ? error.message : "Stripe payout failed.",
      });
      if (released.error) console.error("Could not release failed withdrawal reservation", released.error);
    }
    console.error("Company withdrawal failed", error);
    return fail(error instanceof Error ? error.message : "Withdrawal could not be created.", 409);
  }
}
