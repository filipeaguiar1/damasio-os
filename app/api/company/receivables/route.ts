import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function cadAmount(rows: Array<{ currency?: string; amount?: number }>) {
  return rows.filter((row) => String(row.currency || "").toLowerCase() === "cad")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

async function context(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!url || !serviceKey || !stripeKey) throw new Error("Receivables are not configured.");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Company Admin.");
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");
  const { data: profile, error: profileError } = await db.from("profiles").select("id,role,active,company_id,organization_id").eq("id", auth.user.id).maybeSingle();
  if (profileError || !profile?.active || profile.role !== "admin") throw new Error("Only the active Company Admin can view company receivables.");
  const companyId = String(profile.company_id || profile.organization_id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(companyId)) throw new Error("Company account could not be resolved.");
  const { data: company, error: companyError } = await db.from("organizations")
    .select("id,name,stripe_connected_account_id,stripe_connect_status,stripe_payout_schedule,stripe_payout_reconciliation_hold,stripe_payout_reconciliation_note,stripe_payout_reconciled_at")
    .eq("id", companyId).maybeSingle();
  if (companyError || !company) throw new Error(companyError?.message || "Company not found.");
  return { db, stripe: new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" }), company };
}

export async function GET(request: NextRequest) {
  try {
    const { db, stripe, company } = await context(request);
    const [entriesResult, withdrawalsResult] = await Promise.all([
      db.from("company_balance_entries").select("id,company_id,payout_item_id,payment_id,invoice_id,customer_id,visit_id,amount_cents,paid_out_cents,reserved_cents,state,hold_reason,stripe_transfer_id,released_at,created_at").eq("company_id", company.id).order("created_at", { ascending: false }).limit(150),
      db.from("company_withdrawals").select("id,amount_cents,status,system_generated,origin,unmatched_cents,stripe_payout_id,estimated_arrival_at,failure_message,requested_at,processed_at,paid_at").eq("company_id", company.id).order("requested_at", { ascending: false }).limit(80),
    ]);
    if (entriesResult.error) throw new Error(entriesResult.error.message);
    if (withdrawalsResult.error) throw new Error(withdrawalsResult.error.message);
    const entries = entriesResult.data || [];
    const withdrawals = withdrawalsResult.data || [];
    const customerIds = Array.from(new Set(entries.map((row: any) => row.customer_id).filter(Boolean)));
    let customerNames = new Map<string, string>();
    if (customerIds.length) {
      const customers = await db.from("customers").select("id,full_name").in("id", customerIds);
      if (customers.error) throw new Error(customers.error.message);
      customerNames = new Map((customers.data || []).map((row: any) => [String(row.id), String(row.full_name || "Customer")]));
    }

    let stripeAvailableCents = 0;
    let stripePendingCents = 0;
    const stripeStatus = company.stripe_connect_status || "not_started";
    let stripeError: string | null = null;
    if (company.stripe_connected_account_id && stripeStatus === "enabled") {
      try {
        const balance = await stripe.balance.retrieve({}, { stripeAccount: company.stripe_connected_account_id });
        stripeAvailableCents = cadAmount(balance.available as any);
        stripePendingCents = cadAmount(balance.pending as any);
      } catch (error) {
        stripeError = error instanceof Error ? error.message : "Stripe balance could not be read.";
      }
    }

    const outstanding = (row: any) => Math.max(0, Number(row.amount_cents || 0) - Number(row.paid_out_cents || 0) - Number(row.reserved_cents || 0));
    const pendingCents = entries.filter((row: any) => ["pending", "hold", "release_ready", "transferring"].includes(String(row.state))).reduce((sum: number, row: any) => sum + outstanding(row), 0);
    const internalAvailableCents = entries.filter((row: any) => row.state === "available").reduce((sum: number, row: any) => sum + outstanding(row), 0);
    const processingCents = withdrawals.filter((row: any) => ["reserved", "processing"].includes(String(row.status))).reduce((sum: number, row: any) => sum + Number(row.amount_cents || 0), 0);
    const paidOutCents = withdrawals.filter((row: any) => row.status === "paid").reduce((sum: number, row: any) => sum + Number(row.amount_cents || 0), 0);
    const reconciliationHold = Boolean(company.stripe_payout_reconciliation_hold);
    const withdrawableCents = reconciliationHold ? 0 : Math.max(0, Math.min(internalAvailableCents, stripeAvailableCents));
    const ledger = entries.map((row: any) => ({ ...row, customerName: customerNames.get(String(row.customer_id || "")) || "Customer", outstandingCents: outstanding(row) }));

    return NextResponse.json({
      company: { id: company.id, name: company.name },
      stripe: { status: stripeStatus, payoutSchedule: company.stripe_payout_schedule || null, availableCents: stripeAvailableCents, pendingCents: stripePendingCents, error: stripeError },
      balances: { pendingCents, internalAvailableCents, processingCents, paidOutCents, withdrawableCents },
      reconciliation: {
        safe: !stripeError && !reconciliationHold && withdrawableCents <= internalAvailableCents && withdrawableCents <= stripeAvailableCents,
        hold: reconciliationHold,
        holdNote: company.stripe_payout_reconciliation_note || null,
        lastReconciledAt: company.stripe_payout_reconciled_at || null,
        stripeDifferenceCents: stripeAvailableCents - internalAvailableCents,
        note: reconciliationHold
          ? company.stripe_payout_reconciliation_note || "Withdrawals are blocked while Master reconciles an external Stripe payout."
          : stripeAvailableCents < internalAvailableCents
            ? "Some released earnings are still settling at Stripe. Withdrawals are capped by Stripe's actually available CAD balance."
            : stripeAvailableCents > internalAvailableCents
              ? "Stripe contains more available CAD than the platform ledger has released. The extra amount is intentionally not withdrawable here."
              : "Internal released balance and Stripe available balance are aligned.",
      },
      ledger,
      withdrawals,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Receivables could not be loaded.", 403);
  }
}
