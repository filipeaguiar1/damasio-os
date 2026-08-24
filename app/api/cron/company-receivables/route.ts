import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function cadAvailable(balance: Stripe.Balance) {
  return balance.available.filter((row) => row.currency === "cad").reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

async function createConnectedPayout(
  db: any,
  stripe: Stripe,
  company: any,
  amountCents: number,
  systemGenerated: boolean,
) {
  const reserve = await db.rpc("reserve_company_withdrawal", {
    p_company_id: company.id,
    p_amount_cents: amountCents,
    p_requested_by: null,
    p_system_generated: systemGenerated,
  });
  if (reserve.error) throw new Error(reserve.error.message);
  const withdrawalId = String(reserve.data || "");
  if (!withdrawalId) throw new Error("Safety withdrawal reservation failed.");
  try {
    const payout = await stripe.payouts.create({
      amount: amountCents,
      currency: "cad",
      metadata: { withdrawalId, companyId: company.id, platform: "4ever-seasons", reason: "manual-balance-safety" },
    }, {
      stripeAccount: company.stripe_connected_account_id,
      idempotencyKey: `company-withdrawal-${withdrawalId}`,
    });
    const arrival = payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null;
    const saved = await db.from("company_withdrawals").update({
      status: "processing",
      stripe_payout_id: payout.id,
      stripe_available_cents_at_request: amountCents,
      estimated_arrival_at: arrival,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", withdrawalId);
    if (saved.error) throw new Error(saved.error.message);
    if (payout.status === "paid") {
      const done = await db.rpc("complete_company_withdrawal", { p_withdrawal_id: withdrawalId, p_stripe_payout_id: payout.id });
      if (done.error) throw new Error(done.error.message);
    }
    return withdrawalId;
  } catch (error) {
    await db.rpc("release_company_withdrawal_reservation", {
      p_withdrawal_id: withdrawalId,
      p_failure_code: "safety_payout_failed",
      p_failure_message: error instanceof Error ? error.message : "Safety payout failed.",
    });
    throw error;
  }
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!url || !serviceKey || !stripeKey) return NextResponse.json({ error: "Company receivables are not configured." }, { status: 503 });

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
  const results: Array<{ type: string; id: string; ok: boolean; message: string }> = [];

  try {
    const ready = await db.from("company_balance_entries")
      .select("id,company_id,payout_item_id,amount_cents,stripe_charge_id,state")
      .eq("state", "release_ready")
      .order("created_at", { ascending: true })
      .limit(100);
    if (ready.error) throw new Error(ready.error.message);

    for (const entry of ready.data || []) {
      try {
        const { data: company, error: companyError } = await db.from("organizations")
          .select("id,stripe_connected_account_id,stripe_connect_status")
          .eq("id", entry.company_id).maybeSingle();
        if (companyError) throw new Error(companyError.message);
        if (!company?.stripe_connected_account_id || company.stripe_connect_status !== "enabled") {
          results.push({ type: "release", id: entry.id, ok: false, message: "Stripe Connect is not enabled." });
          continue;
        }

        const claimed = await db.from("company_balance_entries").update({ state: "transferring", updated_at: new Date().toISOString() })
          .eq("id", entry.id).eq("state", "release_ready").select("id").maybeSingle();
        if (claimed.error) throw new Error(claimed.error.message);
        if (!claimed.data) continue;

        try {
          const transfer = await stripe.transfers.create({
            amount: Number(entry.amount_cents),
            currency: "cad",
            destination: company.stripe_connected_account_id,
            ...(entry.stripe_charge_id ? { source_transaction: entry.stripe_charge_id } : {}),
            metadata: { balanceEntryId: entry.id, payoutItemId: entry.payout_item_id, companyId: entry.company_id, platform: "4ever-seasons" },
          }, { idempotencyKey: `company-balance-transfer-${entry.id}` });

          const updateEntry = await db.from("company_balance_entries").update({
            state: "available",
            stripe_transfer_id: transfer.id,
            stripe_transfer_created_at: new Date().toISOString(),
            released_at: new Date().toISOString(),
            hold_reason: null,
            updated_at: new Date().toISOString(),
          }).eq("id", entry.id);
          if (updateEntry.error) throw new Error(updateEntry.error.message);

          const payoutItemUpdate = await db.from("company_payout_items").update({
            status: "transferred",
            stripe_transfer_id: transfer.id,
            transferred_at: new Date().toISOString(),
            hold_reason: "Released to company Stripe balance; bank payout remains company-controlled.",
            updated_at: new Date().toISOString(),
          }).eq("id", entry.payout_item_id);
          if (payoutItemUpdate.error) throw new Error(payoutItemUpdate.error.message);
          results.push({ type: "release", id: entry.id, ok: true, message: transfer.id });
        } catch (error) {
          await db.from("company_balance_entries").update({
            state: "release_ready",
            hold_reason: error instanceof Error ? error.message.slice(0, 500) : "Stripe transfer failed.",
            updated_at: new Date().toISOString(),
          }).eq("id", entry.id).eq("state", "transferring");
          throw error;
        }
      } catch (error) {
        results.push({ type: "release", id: entry.id, ok: false, message: error instanceof Error ? error.message : "Release failed." });
      }
    }

    const processing = await db.from("company_withdrawals")
      .select("id,company_id,stripe_payout_id,status")
      .eq("status", "processing")
      .not("stripe_payout_id", "is", null)
      .limit(100);
    if (processing.error) throw new Error(processing.error.message);

    for (const withdrawal of processing.data || []) {
      try {
        const { data: company } = await db.from("organizations").select("stripe_connected_account_id").eq("id", withdrawal.company_id).maybeSingle();
        if (!company?.stripe_connected_account_id) continue;
        const payout = await stripe.payouts.retrieve(withdrawal.stripe_payout_id, { stripeAccount: company.stripe_connected_account_id });
        if (payout.status === "paid") {
          const done = await db.rpc("complete_company_withdrawal", { p_withdrawal_id: withdrawal.id, p_stripe_payout_id: payout.id });
          if (done.error) throw new Error(done.error.message);
        } else if (["failed", "canceled"].includes(String(payout.status))) {
          const released = await db.rpc("release_company_withdrawal_reservation", {
            p_withdrawal_id: withdrawal.id,
            p_failure_code: String(payout.failure_code || payout.status || "payout_failed"),
            p_failure_message: payout.failure_message || `Stripe payout ${payout.status}.`,
          });
          if (released.error) throw new Error(released.error.message);
        }
        results.push({ type: "withdrawal", id: withdrawal.id, ok: true, message: payout.status });
      } catch (error) {
        results.push({ type: "withdrawal", id: withdrawal.id, ok: false, message: error instanceof Error ? error.message : "Payout reconciliation failed." });
      }
    }

    // Stripe manual payouts must not be used as indefinite escrow. In Canada the connected balance
    // has a finite holding window, so an old released balance receives a conservative safety payout.
    const oldEntries = await db.from("company_balance_entries")
      .select("company_id,released_at")
      .eq("state", "available")
      .lt("released_at", new Date(Date.now() - 75 * 24 * 60 * 60 * 1000).toISOString())
      .order("released_at", { ascending: true })
      .limit(100);
    if (oldEntries.error) throw new Error(oldEntries.error.message);
    const oldCompanies = Array.from(new Set((oldEntries.data || []).map((row: any) => String(row.company_id))));

    for (const companyId of oldCompanies) {
      try {
        const { data: company } = await db.from("organizations")
          .select("id,stripe_connected_account_id,stripe_connect_status")
          .eq("id", companyId).maybeSingle();
        if (!company?.stripe_connected_account_id || company.stripe_connect_status !== "enabled") continue;
        const entries = await db.from("company_balance_entries")
          .select("amount_cents,paid_out_cents,reserved_cents")
          .eq("company_id", companyId).eq("state", "available");
        if (entries.error) throw new Error(entries.error.message);
        const internal = (entries.data || []).reduce((sum: number, row: any) => sum + Math.max(0, Number(row.amount_cents)-Number(row.paid_out_cents)-Number(row.reserved_cents)), 0);
        const balance = await stripe.balance.retrieve({ stripeAccount: company.stripe_connected_account_id });
        const amount = Math.min(internal, cadAvailable(balance));
        if (amount >= 100) {
          const withdrawalId = await createConnectedPayout(db, stripe, company, amount, true);
          results.push({ type: "safety_payout", id: withdrawalId, ok: true, message: `${amount} cents` });
        }
      } catch (error) {
        results.push({ type: "safety_payout", id: companyId, ok: false, message: error instanceof Error ? error.message : "Safety payout failed." });
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error("Company receivables cron failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Receivables cron failed.", results }, { status: 500 });
  }
}
