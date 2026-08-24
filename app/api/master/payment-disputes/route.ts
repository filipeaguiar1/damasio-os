import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

type MasterOutcome = "company" | "customer";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Master payment disputes are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const db = serviceClient();
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Master session expired. Sign in again.");
  const { data: profile, error } = await db.from("profiles").select("id,role,active").eq("id", auth.user.id).single();
  if (error || !profile?.active || profile.role !== "master") throw new Error("Master access is required.");
  return { db, masterId: String(auth.user.id) };
}

function failure(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Master dispute request failed." }, { status });
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
}

export async function GET(request: NextRequest) {
  try {
    const { db } = await requireMaster(request);
    const { data: rows, error } = await db.from("service_requests")
      .select("id,company_id,customer_id,visit_id,invoice_id,payment_id,message,status,created_at,response_due_at,company_response,company_responded_at,customer_decision,customer_decision_at,master_resolution,master_reviewed_at,master_outcome,master_reviewed_by_profile_id,master_refund_id,master_refund_requested_at")
      .eq("request_type", "payment_dispute").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const companyIds = [...new Set((rows || []).map((row: any) => row.company_id).filter(Boolean))];
    const customerIds = [...new Set((rows || []).map((row: any) => row.customer_id).filter(Boolean))];
    const invoiceIds = [...new Set((rows || []).map((row: any) => row.invoice_id).filter(Boolean))];
    const [{ data: companies }, { data: customers }, { data: invoices }] = await Promise.all([
      companyIds.length ? db.from("organizations").select("id,name,contact_email").in("id", companyIds) : Promise.resolve({ data: [] }),
      customerIds.length ? db.from("customers").select("id,full_name,email").in("id", customerIds) : Promise.resolve({ data: [] }),
      invoiceIds.length ? db.from("invoices").select("id,invoice_number,total,status").in("id", invoiceIds) : Promise.resolve({ data: [] }),
    ]);
    const companyMap = new Map((companies || []).map((row: any) => [String(row.id), row]));
    const customerMap = new Map((customers || []).map((row: any) => [String(row.id), row]));
    const invoiceMap = new Map((invoices || []).map((row: any) => [String(row.id), row]));
    const now = Date.now();
    const disputes = (rows || []).map((row: any) => ({
      ...row,
      company: companyMap.get(String(row.company_id)) || null,
      customer: customerMap.get(String(row.customer_id)) || null,
      invoice: invoiceMap.get(String(row.invoice_id)) || null,
      overdue: ["pending", "open", "investigating"].includes(String(row.status))
        && row.response_due_at
        && new Date(row.response_due_at).getTime() < now,
    }));
    return NextResponse.json({ disputes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Master disputes could not be loaded.";
    return failure(error, /session expired|sign in/i.test(message) ? 401 : /Master access/i.test(message) ? 403 : 400);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, masterId } = await requireMaster(request);
    const body = await request.json() as { disputeId?: string; outcome?: MasterOutcome; resolution?: string };
    const disputeId = String(body.disputeId || "").trim();
    const outcome = String(body.outcome || "") as MasterOutcome;
    const resolution = String(body.resolution || "").trim();
    if (!validUuid(disputeId)) throw new Error("Choose a valid payment dispute.");
    if (!(["company", "customer"] as string[]).includes(outcome)) throw new Error("Choose whether the company or customer prevails.");
    if (resolution.length < 5 || resolution.length > 1000) throw new Error("Write a Master resolution of 5 to 1000 characters.");

    if (outcome === "company") {
      const result = await db.rpc("resolve_master_payment_dispute_for_company", {
        p_master_id: masterId,
        p_request_id: disputeId,
        p_resolution: resolution,
      });
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json(result.data || { saved: true, status: "resolved", outcome: "company" });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return failure(new Error("Stripe refunds are not configured."), 503);

    // First move the dispute and any company earning into a protected refund-pending state.
    // A network retry reuses this state and the deterministic Stripe idempotency key.
    const pendingResult = await db.rpc("mark_master_payment_dispute_refund_pending", {
      p_master_id: masterId,
      p_request_id: disputeId,
      p_resolution: resolution,
    });
    if (pendingResult.error) throw new Error(pendingResult.error.message);
    const prepared = pendingResult.data || {};
    if (String(prepared.status) === "resolved") {
      return NextResponse.json({ ...prepared, refundCompleted: true });
    }

    const chargeId = String(prepared.chargeId || "");
    if (!chargeId) throw new Error("Canonical payment has no Stripe charge to refund.");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const charge = await stripe.charges.retrieve(chargeId);
    const existingRefundId = charge.refunded ? String(charge.refunds?.data?.[0]?.id || "") : "";
    const refund = existingRefundId
      ? { id: existingRefundId }
      : await stripe.refunds.create({
        charge: chargeId,
        reason: "requested_by_customer",
        metadata: {
          paymentDisputeId: disputeId,
          paymentId: String(prepared.paymentId || ""),
          companyId: String(prepared.companyId || ""),
          masterProfileId: masterId,
          source: "4ever-seasons-master-resolution",
        },
      }, { idempotencyKey: `master-dispute-refund-${disputeId}` });

    const refundId = String(refund.id || "");
    if (!refundId) throw new Error("Stripe did not return a refund id.");

    if (prepared.payoutExists) {
      const saved = await db.from("service_requests").update({
        master_refund_id: refundId,
        master_refund_requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", disputeId).eq("status", "refund_pending").eq("master_outcome", "customer");
      if (saved.error) console.error("Master refund id could not be stamped locally; webhook reconciliation will continue", saved.error);
      return NextResponse.json({
        saved: true,
        status: "refund_pending",
        outcome: "customer",
        refundId,
        refundCompleted: false,
        message: "Stripe accepted the refund. The dispute remains locked until payout reversal reconciliation completes.",
      });
    }

    // Legacy payments without a payout item have nothing to reverse on Stripe Connect.
    // Finalize their local payment/invoice only after Stripe has confirmed the refund above.
    const finalized = await db.rpc("finalize_master_refund_without_payout", {
      p_master_id: masterId,
      p_request_id: disputeId,
      p_refund_id: refundId,
    });
    if (finalized.error) throw new Error(`Stripe refund ${refundId} succeeded but local finalization needs reconciliation: ${finalized.error.message}`);
    return NextResponse.json({
      saved: true,
      status: "resolved",
      outcome: "customer",
      refundId,
      refundCompleted: true,
    });
  } catch (error) {
    console.error("Master payment dispute resolution failed", error);
    const message = error instanceof Error ? error.message : "Master dispute request failed.";
    const status = /session expired|sign in/i.test(message) ? 401
      : /Master access|required|Only an active Master/i.test(message) ? 403
      : /already|only an escalated|only an overdue|refund is already|not eligible|no canonical|no Stripe charge|reversed|cancelled/i.test(message) ? 409
      : 400;
    return failure(error, status);
  }
}
