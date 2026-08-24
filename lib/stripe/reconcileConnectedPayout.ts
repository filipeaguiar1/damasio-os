import type Stripe from "stripe";

type Db = any;

function requireDatabaseSuccess(error: { message?: string; code?: string } | null | undefined, operation: string) {
  if (error) throw new Error(`${operation}: ${error.message || error.code || "database request failed"}`);
}

function payoutFailureMessage(payout: Stripe.Payout) {
  return payout.failure_message || (payout.failure_code ? `Stripe payout failed: ${payout.failure_code}` : `Stripe payout ${payout.status}.`);
}

async function companyForEvent(db: Db, event: Stripe.Event) {
  const accountId = typeof event.account === "string" ? event.account : "";
  if (!accountId) return null;
  const result = await db.from("organizations")
    .select("id,name,stripe_connected_account_id,stripe_payout_reconciliation_hold")
    .eq("stripe_connected_account_id", accountId)
    .maybeSingle();
  requireDatabaseSuccess(result.error, "Find Stripe connected company");
  return result.data || null;
}

async function withdrawalForPayout(db: Db, payoutId: string) {
  const result = await db.from("company_withdrawals")
    .select("id,company_id,status,origin,unmatched_cents,stripe_payout_id")
    .eq("stripe_payout_id", payoutId)
    .maybeSingle();
  requireDatabaseSuccess(result.error, "Find Stripe payout withdrawal");
  return result.data || null;
}

export async function reconcileConnectedPayout(db: Db, event: Stripe.Event) {
  const payout = event.data.object as Stripe.Payout;
  const company = await companyForEvent(db, event);
  if (!company) return;

  let withdrawal = await withdrawalForPayout(db, payout.id);
  if (!withdrawal) {
    const reserved = await db.rpc("reserve_external_company_payout", {
      p_company_id: company.id,
      p_amount_cents: Number(payout.amount || 0),
      p_stripe_payout_id: payout.id,
      p_stripe_event_id: event.id,
    });
    requireDatabaseSuccess(reserved.error, "Reserve external Stripe payout");
    const withdrawalId = String(reserved.data || "");
    if (!withdrawalId) throw new Error("External Stripe payout did not create a reconciliation record.");
    const result = await db.from("company_withdrawals")
      .select("id,company_id,status,origin,unmatched_cents,stripe_payout_id")
      .eq("id", withdrawalId)
      .maybeSingle();
    requireDatabaseSuccess(result.error, "Load external Stripe payout withdrawal");
    withdrawal = result.data;
  }
  if (!withdrawal?.id) throw new Error("Stripe payout reconciliation record is unavailable.");

  const arrival = payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null;
  const commonUpdate = await db.from("company_withdrawals").update({
    stripe_payout_id: payout.id,
    estimated_arrival_at: arrival,
    processed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", withdrawal.id);
  requireDatabaseSuccess(commonUpdate.error, "Update Stripe payout reconciliation");

  if (event.type === "payout.paid" || payout.status === "paid") {
    const completed = withdrawal.origin === "stripe_dashboard"
      ? await db.rpc("complete_external_company_withdrawal", { p_withdrawal_id: withdrawal.id, p_stripe_payout_id: payout.id })
      : await db.rpc("complete_company_withdrawal", { p_withdrawal_id: withdrawal.id, p_stripe_payout_id: payout.id });
    requireDatabaseSuccess(completed.error, "Complete Stripe payout reconciliation");
  } else if (event.type === "payout.failed" || event.type === "payout.canceled" || ["failed", "canceled"].includes(String(payout.status))) {
    const released = await db.rpc("release_company_withdrawal_reservation", {
      p_withdrawal_id: withdrawal.id,
      p_failure_code: String(payout.failure_code || payout.status || "payout_failed"),
      p_failure_message: payoutFailureMessage(payout),
    });
    requireDatabaseSuccess(released.error, "Release failed Stripe payout reservation");
  } else {
    const processing = await db.from("company_withdrawals").update({
      status: "processing",
      failure_code: null,
      failure_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", withdrawal.id).in("status", ["reserved", "processing"]);
    requireDatabaseSuccess(processing.error, "Mark Stripe payout processing");
  }

  const reconciled = await db.from("organizations").update({
    stripe_payout_reconciled_at: new Date().toISOString(),
  }).eq("id", company.id);
  requireDatabaseSuccess(reconciled.error, "Stamp Stripe payout reconciliation");
}
