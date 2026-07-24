import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function configured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!url || !serviceKey || !stripeKey) throw new Error("Weekly payouts are not configured.");
  return { url, serviceKey, stripeKey };
}

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const { url, serviceKey, stripeKey } = configured();
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const today = new Date().toISOString().slice(0, 10);

    const { data: batches, error } = await db
      .from("company_payout_batches")
      .select("id,company_id,week_start,week_end,scheduled_payout_date,total_transfer_amount,status")
      .eq("status", "approved")
      .lte("scheduled_payout_date", today)
      .limit(20);
    if (error) throw new Error(error.message);

    const results: Array<{ batchId: string; ok: boolean; message: string }> = [];
    for (const batch of batches || []) {
      const { data: company } = await db
        .from("organizations")
        .select("id,name,stripe_connected_account_id,stripe_connect_status")
        .eq("id", batch.company_id)
        .maybeSingle();
      if (!company?.stripe_connected_account_id || company.stripe_connect_status !== "enabled") {
        results.push({ batchId: batch.id, ok: false, message: "Company Connect account is not enabled." });
        continue;
      }

      const { data: claimed } = await db
        .from("company_payout_batches")
        .update({ status: "processing" })
        .eq("id", batch.id)
        .eq("status", "approved")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      const { data: items, error: itemsError } = await db
        .from("company_payout_items")
        .select("id,transfer_amount,stripe_transfer_group")
        .eq("batch_id", batch.id)
        .eq("status", "approved");
      if (itemsError) throw new Error(itemsError.message);

      const amountCents = Math.round((items || []).reduce((sum: number, item: any) => sum + Number(item.transfer_amount || 0), 0) * 100);
      if (!Number.isSafeInteger(amountCents) || amountCents < 50) {
        await db.from("company_payout_batches").update({ status: "failed", processed_at: new Date().toISOString() }).eq("id", batch.id);
        results.push({ batchId: batch.id, ok: false, message: "Batch has no transferable amount." });
        continue;
      }

      try {
        const transfer = await stripe.transfers.create({
          amount: amountCents,
          currency: "cad",
          destination: company.stripe_connected_account_id,
          metadata: {
            batchId: batch.id,
            companyId: batch.company_id,
            weekStart: batch.week_start,
            weekEnd: batch.week_end,
          },
        }, { idempotencyKey: `weekly-payout-${batch.id}` });

        await db.from("company_payout_items").update({
          status: "transferred",
          stripe_transfer_id: transfer.id,
          transferred_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("batch_id", batch.id).eq("status", "approved");

        await db.from("company_payout_batches").update({
          status: "paid",
          stripe_transfer_ids: [transfer.id],
          processed_at: new Date().toISOString(),
        }).eq("id", batch.id);

        results.push({ batchId: batch.id, ok: true, message: `Transferred ${transfer.id}.` });
      } catch (transferError) {
        const message = transferError instanceof Error ? transferError.message : "Stripe transfer failed.";
        await db.from("company_payout_batches").update({ status: "failed", processed_at: new Date().toISOString() }).eq("id", batch.id);
        results.push({ batchId: batch.id, ok: false, message });
      }
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    console.error("Weekly payout cron failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Weekly payout cron failed." }, { status: 500 });
  }
}
