import { NextRequest, NextResponse } from "next/server";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

function failure(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }

export async function GET(request: NextRequest) {
  try {
    const { service, identity } = await requireCustomerPortalIdentity(request);
    const visitId = String(new URL(request.url).searchParams.get("visitId") || "");
    if (!visitId || !identity.customerId || !identity.companyId) return NextResponse.json({ dispute: null });
    const { data, error } = await service.from("service_requests")
      .select("id,visit_id,invoice_id,payment_id,message,status,created_at,response_due_at,company_response,company_responded_at,customer_decision,customer_decision_at,master_resolution,master_reviewed_at")
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
      const disputeId = String(body.disputeId || ""); const decision = body.decision;
      if (!disputeId || !["accepted", "insist"].includes(String(decision))) return failure("Choose how to proceed with the company response.");
      const { data: current, error: readError } = await service.from("service_requests").select("id,status,company_response").eq("id", disputeId).eq("customer_id", identity.customerId).eq("company_id", identity.companyId).eq("request_type", "payment_dispute").maybeSingle();
      if (readError || !current) return failure("Payment dispute was not found.", 404);
      if (current.status !== "company_responded" || !current.company_response) return failure("Wait for the company response before choosing the next step.");
      const nextStatus = decision === "insist" ? "escalated" : "resolved";
      const { error } = await service.from("service_requests").update({ status: nextStatus, customer_decision: decision, customer_decision_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", disputeId).eq("customer_id", identity.customerId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ saved: true, status: nextStatus });
    }

    const visitId = String(body.visitId || "").trim(); const reason = String(body.reason || "").trim();
    if (!visitId) return failure("Choose a completed service first.");
    if (reason.length < 5) return failure("Please explain the payment issue in at least 5 characters.");
    const result = await service.rpc("open_customer_payment_dispute_protected", { p_customer_id: identity.customerId, p_company_id: identity.companyId, p_visit_id: visitId, p_reason: reason });
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json(result.data || { saved: true });
  } catch (error) {
    console.error("customer-payment-dispute", error);
    const message = error instanceof Error ? error.message : "Payment dispute could not be opened.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different company|does not belong|not linked/i.test(message) ? 403 : 400;
    return failure(message, status);
  }
}
