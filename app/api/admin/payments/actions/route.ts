import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { z } from "zod";
import { stripeReturnOrigin } from "@/lib/stripe/checkoutOrigin";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("advance"), customerId: z.string().uuid(), amount: z.number().min(5).max(10000), note: z.string().trim().max(240).optional() }),
  z.object({ action: z.literal("preference"), customerId: z.string().uuid(), method: z.enum(["card", "account_balance"]) }),
]);

function configured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Payment administration is not configured.");
  return { url, anonKey, serviceKey };
}

function serviceClient() {
  const { url, serviceKey } = configured();
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function userClient(token: string) {
  const { url, anonKey } = configured();
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

async function requireFinanceOperator(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as a company Admin or Manager.");
  const service = serviceClient();
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your company session expired. Sign in again.");
  const { data: profile, error } = await service.from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error || !profile?.active || !["admin", "manager"].includes(String(profile.role))) throw new Error("Company finance access required.");
  const companyId = String(profile.company_id || profile.organization_id || "");
  if (!companyId) throw new Error("Company context is required.");
  if (profile.role === "manager") {
    const permission = await userClient(token).rpc("require_company_module_permission", { p_module: "finance", p_required: "manage" });
    if (permission.error) throw new Error(permission.error.message);
  }
  return { service, actorId: auth.user.id, companyId };
}

async function customerForCompany(service: any, companyId: string, customerId: string) {
  const { data: customer, error } = await service.from("customers")
    .select("id,profile_id,full_name,email,company_id,organization_id,service_company_id,acquisition_source,platform_managed,offer_status,assignment_status,service_payment_method,archived_at")
    .eq("id", customerId)
    .maybeSingle();
  if (error || !customer || customer.archived_at) throw new Error("Customer is unavailable.");
  const platform = Boolean(customer.platform_managed) || customer.acquisition_source === "platform";
  const allowed = platform
    ? String(customer.service_company_id || "") === companyId && customer.offer_status === "accepted" && ["accepted", "assigned", "active"].includes(String(customer.assignment_status || ""))
    : String(customer.company_id || customer.organization_id || "") === companyId;
  if (!allowed) throw new Error("Customer does not belong to this company workspace.");
  return customer;
}

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const { service, actorId, companyId } = await requireFinanceOperator(request);
    const customer = await customerForCompany(service, companyId, body.customerId);

    if (body.action === "preference") {
      const { error } = await service.from("customers")
        .update({ service_payment_method: body.method })
        .eq("id", customer.id);
      if (error) throw new Error(error.message);
      await service.from("activity_log").insert({
        organization_id: companyId,
        company_id: companyId,
        actor_profile_id: actorId,
        action: "customer.payment_method_updated",
        entity_type: "customer",
        entity_id: customer.id,
        details: `Preferred service payment method changed to ${body.method}.`,
      });
      return NextResponse.json({ saved: true, method: body.method });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
    if (!customer.profile_id) return NextResponse.json({ error: "Customer must activate their account before an advance payment can be requested." }, { status: 409 });
    const amountCents = Math.round(body.amount * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 500) return NextResponse.json({ error: "Choose a valid advance amount." }, { status: 400 });

    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const metadata = {
      paymentKind: "wallet_topup",
      companyId,
      customerId: String(customer.id),
      profileId: String(customer.profile_id),
      credits: String(Math.round(body.amount)),
      amountCents: String(amountCents),
      requestedBy: actorId,
      requestKind: "admin_advance",
    };
    const origin = stripeReturnOrigin(request);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customer.email || undefined,
      line_items: [{ quantity: 1, price_data: {
        currency: "cad",
        unit_amount: amountCents,
        product_data: {
          name: "Advance service credit",
          description: body.note || "Account credit requested by your service company. Credit is available for future canonical service invoices after Stripe confirms payment.",
        },
      } }],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/payment/cancel?advance=1`,
    });

    await service.from("activity_log").insert({
      organization_id: companyId,
      company_id: companyId,
      actor_profile_id: actorId,
      action: "customer.advance_payment_requested",
      entity_type: "customer",
      entity_id: customer.id,
      details: `Advance account credit requested: CAD ${(amountCents / 100).toFixed(2)}.`,
    });

    return NextResponse.json({ created: true, url: session.url, sessionId: session.id, amount: amountCents / 100 });
  } catch (error) {
    console.error("admin-payment-actions", error);
    const message = error instanceof Error ? error.message : "Payment action failed.";
    const status = /session expired|sign in/i.test(message) ? 401 : /does not belong|access required|permission/i.test(message) ? 403 : /Customer|amount|activate/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
