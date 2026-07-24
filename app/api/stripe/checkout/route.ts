import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!url || !serviceKey || !stripeKey || !siteUrl) {
      return failure("Card payments are not available yet.", 503);
    }

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return failure("Sign in before paying an invoice.", 401);

    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return failure("Your session expired. Sign in again.", 401);

    const body = (await request.json()) as { invoiceId?: string };
    const invoiceId = String(body.invoiceId || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(invoiceId)) return failure("Choose a valid invoice.", 400);

    const { data: invoice, error: invoiceError } = await db
      .from("invoices")
      .select("id,company_id,organization_id,customer_id,invoice_number,status,total")
      .eq("id", invoiceId)
      .single();
    if (invoiceError || !invoice) return failure("Invoice not found.", 404);

    const companyId = invoice.company_id || invoice.organization_id;
    const [{ data: profile }, { data: customer }] = await Promise.all([
      db.from("profiles").select("role,active,company_id,organization_id").eq("id", auth.user.id).maybeSingle(),
      db.from("customers").select("id,profile_id,email,full_name").eq("id", invoice.customer_id).maybeSingle()
    ]);
    const isCompanyOperator = Boolean(
      profile?.active && ["admin", "manager", "master"].includes(profile.role) &&
      (profile.company_id || profile.organization_id) === companyId
    );
    const isInvoiceCustomer = customer?.profile_id === auth.user.id;
    if (!isCompanyOperator && !isInvoiceCustomer) return failure("You cannot pay this invoice.", 403);

    if (!["sent", "waiting_payment", "overdue"].includes(String(invoice.status))) {
      return failure("This invoice is not open for card payment.", 409);
    }
    const cents = Math.round(Number(invoice.total) * 100);
    if (!Number.isSafeInteger(cents) || cents < 50) return failure("This invoice has no valid amount to charge.", 409);

    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const transferGroup = `invoice-${invoice.id}`;
    const metadata = { invoiceId: invoice.id, companyId, customerId: invoice.customer_id || "" };
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customer?.email || auth.user.email || undefined,
      line_items: [{ quantity: 1, price_data: { currency: "cad", unit_amount: cents, product_data: { name: `Invoice ${invoice.invoice_number}` } } }],
      metadata,
      payment_intent_data: { metadata, transfer_group: transferGroup },
      success_url: `${siteUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/payment/cancel?invoiceId=${invoice.id}`
    }, { idempotencyKey: `checkout-${invoice.id}-${cents}` });

    const stripeUpdate = await db.from("invoices").update({
      stripe_checkout_session_id: session.id,
      stripe_transfer_group: transferGroup,
      status: "processing"
    }).eq("id", invoice.id);
    if (stripeUpdate.error) {
      await db.from("invoices").update({ status: "processing" }).eq("id", invoice.id);
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout failed", error);
    return failure("Could not start card checkout.", 500);
  }
}
