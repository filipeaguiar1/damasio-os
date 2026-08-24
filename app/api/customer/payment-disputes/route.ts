import { NextRequest, NextResponse } from "next/server";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

function failure(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }

const OPEN_DISPUTE_STATUSES = ["pending", "open", "investigating", "company_responded", "escalated", "overdue", "refund_pending"];

export async function GET(request: NextRequest) {
  try {
    const { service, identity } = await requireCustomerPortalIdentity(request);
    const visitId = String(new URL(request.url).searchParams.get("visitId") || "");
    if (!visitId || !identity.customerId || !identity.companyId) return NextResponse.json({ dispute: null });
    const { data, error } = await service.from("service_requests")
      .select("id,visit_id,invoice_id,payment_id,message,status,created_at,response_due_at,company_response,company_responded_at,customer_decision,customer_decision_at,master_resolution,master_reviewed_at,master_outcome,master_refund_id,master_refund_requested_at")
      .eq("customer_id", identity.customerId).eq("company_id", identity.companyId).eq("visit_id", visitId).eq("request_type", "payment_dispute")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({ dispute: data || null });
  } catch (error) { return failure(error instanceof Error ? error.message : "Payment dispute could not be loaded."); }
}

export async function POST(request: NextRequest) {
  try {
    const { service, identity } = await requireCustomerPortalIdentity(request);
    if (!identity.customerId || !identity.companyId) return failure("Customer account is not linked to a company.", 403);
    const body = await request.json() as { action?: "open" | "decision"; visitId?: string; reason?: string; disputeId?: string; decision?: "accepted" | "insist" };
    if (body.action === "decision") {
      const disputeId = String(body.disputeId || "");
      const decision = body.decision;
      if (!disputeId || !["accepted", "insist"].includes(String(decision))) return failure("Choose how to proceed with the company response.");

      if (decision === "accepted") {
        const resolution = await service.rpc("accept_customer_payment_dispute_resolution", {
          p_customer_id: identity.customerId,
          p_company_id: identity.companyId,
          p_request_id: disputeId,
        });
        if (resolution.error) throw new Error(resolution.error.message);
        return NextResponse.json(resolution.data || { saved: true, status: "resolved" });
      }

      const { data: current, error: readError } = await service.from("service_requests")
        .select("id,status,company_response")
        .eq("id", disputeId)
        .eq("customer_id", identity.customerId)
        .eq("company_id", identity.companyId)
        .eq("request_type", "payment_dispute")
        .maybeSingle();
      if (readError || !current) return failure("Payment dispute was not found.", 404);
      if (current.status !== "company_responded" || !current.company_response) return failure("Wait for the company response before choosing the next step.");
      const { error } = await service.from("service_requests").update({
        status: "escalated",
        customer_decision: "insist",
        customer_decision_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", disputeId).eq("customer_id", identity.customerId).eq("company_id", identity.companyId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ saved: true, status: "escalated" });
    }

    const visitId = String(body.visitId || "").trim();
    const reason = String(body.reason || "").trim();
    if (!visitId) return failure("Choose a completed service first.");
    if (reason.length < 5) return failure("Please explain the payment issue in at least 5 characters.");

    // A Stripe refund still being reconciled is an open dispute. Return the same request
    // instead of allowing a second ticket while company funds remain protected.
    const existing = await service.from("service_requests")
      .select("id,status,response_due_at,invoice_id,payment_id")
      .eq("customer_id", identity.customerId)
      .eq("company_id", identity.companyId)
      .eq("visit_id", visitId)
      .eq("request_type", "payment_dispute")
      .in("status", OPEN_DISPUTE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) {
      return NextResponse.json({
        saved: true,
        duplicate: true,
        requestId: existing.data.id,
        status: existing.data.status,
        responseDueAt: existing.data.response_due_at,
        invoiceId: existing.data.invoice_id,
        paymentId: existing.data.payment_id,
      });
    }

    const result = await service.rpc("open_customer_payment_dispute_protected", {
      p_customer_id: identity.customerId,
      p_company_id: identity.companyId,
      p_visit_id: visitId,
      p_reason: reason,
    });
    if (result.error) {
      // The partial unique index is the race-condition backstop if two browser requests
      // reach the RPC at the same instant.
      if (String(result.error.code || "") === "23505") {
        const raced = await service.from("service_requests")
          .select("id,status,response_due_at,invoice_id,payment_id")
          .eq("customer_id", identity.customerId)
          .eq("company_id", identity.companyId)
          .eq("visit_id", visitId)
          .eq("request_type", "payment_dispute")
          .in("status", OPEN_DISPUTE_STATUSES)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!raced.error && raced.data) return NextResponse.json({ saved: true, duplicate: true, requestId: raced.data.id, status: raced.data.status, responseDueAt: raced.data.response_due_at, invoiceId: raced.data.invoice_id, paymentId: raced.data.payment_id });
      }
      throw new Error(result.error.message);
    }
    return NextResponse.json(result.data || { saved: true });
  } catch (error) {
    console.error("customer-payment-dispute", error);
    const message = error instanceof Error ? error.message : "Payment dispute could not be opened.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different company|does not belong|not linked/i.test(message) ? 403 : 400;
    return failure(message, status);
  }
}
