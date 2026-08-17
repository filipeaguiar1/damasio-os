import { NextRequest, NextResponse } from "next/server";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

function failure(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const { service, identity } = await requireCustomerPortalIdentity(request);
    if (!identity.customerId || !identity.companyId) {
      return failure("Customer account is not linked to a company.", 403);
    }

    const body = await request.json() as { visitId?: string; reason?: string };
    const visitId = String(body.visitId || "").trim();
    const reason = String(body.reason || "").trim();
    if (!visitId) return failure("Choose a completed service first.");
    if (reason.length < 5) return failure("Please explain the payment issue in at least 5 characters.");

    const result = await service.rpc("open_customer_payment_dispute_protected", {
      p_customer_id: identity.customerId,
      p_company_id: identity.companyId,
      p_visit_id: visitId,
      p_reason: reason,
    });
    if (result.error) throw new Error(result.error.message);

    return NextResponse.json(result.data || { saved: true });
  } catch (error) {
    console.error("customer-payment-dispute", error);
    const message = error instanceof Error ? error.message : "Payment dispute could not be opened.";
    const status = /session expired|sign in/i.test(message) ? 401
      : /different company|does not belong|not linked/i.test(message) ? 403
        : 400;
    return failure(message, status);
  }
}
