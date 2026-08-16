import { NextRequest, NextResponse } from "next/server";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const { service, identity } = await requireCustomerPortalIdentity(request);
    const body = await request.json() as { invoiceId?: string };
    const invoiceId = String(body.invoiceId || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(invoiceId)) {
      return failure("Choose a valid invoice.", 400);
    }

    const { data, error } = await service.rpc("pay_customer_invoice_from_wallet", {
      p_customer_id: identity.customerId,
      p_invoice_id: invoiceId,
    });
    if (error) {
      const message = String(error.message || "Account balance payment failed.");
      const status = /insufficient account balance|wallet not found|chargeback debt/i.test(message)
        ? 409
        : /not found|does not match|only pay validated/i.test(message)
          ? 403
          : 400;
      return failure(message, status);
    }

    return NextResponse.json({
      paid: Boolean(data?.paid),
      duplicate: Boolean(data?.duplicate),
      invoiceId: String(data?.invoice_id || invoiceId),
      paymentId: data?.payment_id ? String(data.payment_id) : null,
      transactionId: data?.transaction_id ? String(data.transaction_id) : null,
      balanceCredits: Number(data?.balance_cents || 0) / 100,
      message: data?.duplicate
        ? "This invoice was already paid from account balance."
        : "Invoice paid successfully from account balance.",
    });
  } catch (error) {
    console.error("Customer wallet invoice payment failed", error);
    const message = error instanceof Error ? error.message : "Account balance payment failed.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active|not linked/i.test(message) ? 403 : 500;
    return failure(message, status);
  }
}
