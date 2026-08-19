import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function checkoutOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  return configured || request.nextUrl.origin;
}

function invoiceNumber(count: number) {
  return `INV-${new Date().getFullYear()}-${String(count + 1).padStart(6, "0")}`;
}

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
}

function profileCompanyId(profile: { company_id?: string | null; organization_id?: string | null } | null) {
  return profile?.company_id || profile?.organization_id || null;
}

function isPlatformCustomer(customer: { acquisition_source?: string | null; platform_managed?: boolean | null } | null) {
  return customer?.acquisition_source === "platform" || customer?.platform_managed === true;
}

function invoiceAccessAllowed(
  profile: { role?: string; active?: boolean; company_id?: string | null; organization_id?: string | null } | null,
  customer: {
    profile_id?: string | null;
    acquisition_source?: string | null;
    platform_managed?: boolean | null;
    origin_company_id?: string | null;
    service_company_id?: string | null;
    company_id?: string | null;
    organization_id?: string | null;
    archived_at?: string | null;
  } | null,
  userId: string,
  companyId: string
) {
  if (!profile?.active || !customer) return false;
  const role = String(profile.role);
  const operatorCompanyId = profileCompanyId(profile);

  if (role === "customer") {
    if (customer.archived_at || customer.profile_id !== userId) return false;
    const customerCompanyId = customer.company_id || customer.organization_id;
    return !(operatorCompanyId && customerCompanyId && operatorCompanyId !== customerCompanyId);
  }

  if (role === "master") return true;
  if (!["admin", "manager"].includes(role) || operatorCompanyId !== companyId) return false;

  const customerOwnerCompanyId = customer?.origin_company_id || customer?.company_id || customer?.organization_id;
  return !isPlatformCustomer(customer) && customerOwnerCompanyId === companyId;
}

function manualRequestAllowed(
  profile: { role?: string; active?: boolean; company_id?: string | null; organization_id?: string | null } | null,
  customer: {
    acquisition_source?: string | null;
    platform_managed?: boolean | null;
    origin_company_id?: string | null;
    company_id?: string | null;
    organization_id?: string | null;
    archived_at?: string | null;
  } | null,
) {
  if (!profile?.active || !customer || customer.archived_at) return false;
  const role = String(profile.role);
  if (role === "master") return true;
  if (!["admin", "manager"].includes(role) || isPlatformCustomer(customer)) return false;
  const companyId = profileCompanyId(profile);
  const customerOwnerCompanyId = customer.origin_company_id || customer.company_id || customer.organization_id;
  return Boolean(companyId && customerOwnerCompanyId === companyId);
}

function userClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Finance authorization is not configured.");
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;
}

async function requireManagerFinancePermission(token: string, profile: { role?: string } | null) {
  if (String(profile?.role) !== "manager") return;
  const result = await userClient(token).rpc("require_company_module_permission", {
    p_module: "finance",
    p_required: "manage",
  });
  if (result.error) throw new Error(result.error.message || "Finance manage permission is required.");
}

async function createManualInvoice(
  db: any,
  auth: { user: { id: string; email?: string | null } },
  token: string,
  body: { customerId?: string; amountCents?: number; description?: string },
) {
  const customerId = String(body.customerId || "").trim();
  if (!uuid(customerId)) return { error: failure("Choose a valid customer.", 400) };

  const amountCents = Math.round(Number(body.amountCents || 0));
  if (!Number.isSafeInteger(amountCents) || amountCents < 50) {
    return { error: failure("Enter an amount of at least $0.50.", 400) };
  }

  const [{ data: profile }, { data: customer, error: customerError }] = await Promise.all([
    db.from("profiles").select("role,active,company_id,organization_id").eq("id", auth.user.id).maybeSingle(),
    db.from("customers").select("id,profile_id,email,full_name,acquisition_source,platform_managed,origin_company_id,service_company_id,company_id,organization_id,archived_at").eq("id", customerId).maybeSingle(),
  ]);
  if (customerError || !customer) return { error: failure("Customer not found.", 404) };
  await requireManagerFinancePermission(token, profile);
  if (!manualRequestAllowed(profile, customer)) {
    return { error: failure("This customer cannot receive payment requests from this account.", 403) };
  }

  const companyId = String(
    (String(profile?.role) === "master"
      ? customer.service_company_id || customer.company_id || customer.organization_id || profileCompanyId(profile)
      : profileCompanyId(profile)) || ""
  );
  if (!uuid(companyId)) return { error: failure("This customer is not connected to a billing company yet.", 409) };

  const [{ count }, { data: property }] = await Promise.all([
    db.from("invoices").select("id", { count: "exact", head: true }).eq("organization_id", companyId),
    db.from("properties").select("id").eq("customer_id", customer.id).limit(1).maybeSingle(),
  ]);
  const total = amountCents / 100;
  const insertPayload: Record<string, unknown> = {
    organization_id: companyId,
    company_id: companyId,
    customer_id: customer.id,
    property_id: property?.id || null,
    invoice_number: invoiceNumber(count || 0),
    status: "waiting_payment",
    subtotal: total,
    tax: 0,
    total,
  };
  let created = await db.from("invoices").insert(insertPayload).select("id,invoice_number").single();
  if (created.error && /company_id|schema cache|column/i.test(created.error.message || "")) {
    const { company_id: _companyId, ...withoutCompanyId } = insertPayload;
    created = await db.from("invoices").insert(withoutCompanyId).select("id,invoice_number").single();
  }
  if (created.error || !created.data) throw new Error(created.error?.message || "Invoice could not be created.");
  return { invoiceId: String(created.data.id), invoiceNumber: String(created.data.invoice_number || "") };
}

export async function POST(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!url || !serviceKey || !stripeKey) {
      const missing = [
        !url && "NEXT_PUBLIC_SUPABASE_URL",
        !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
        !stripeKey && "STRIPE_SECRET_KEY",
      ].filter(Boolean);
      console.error("Stripe Checkout configuration missing", missing);
      return failure("Card payments are not available yet.", 503);
    }

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return failure("Sign in before paying an invoice.", 401);

    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return failure("Your session expired. Sign in again.", 401);

    const body = (await request.json()) as { invoiceId?: string; customerId?: string; amountCents?: number; description?: string };
    let invoiceId = String(body.invoiceId || "").trim();
    let createdManualInvoice: { invoiceId?: string; invoiceNumber?: string } = {};
    if (!invoiceId) {
      const manual = await createManualInvoice(db, auth as any, token, body);
      if ("error" in manual) return manual.error;
      invoiceId = manual.invoiceId;
      createdManualInvoice = manual;
    }
    if (!uuid(invoiceId)) return failure("Choose a valid invoice.", 400);

    const { data: invoice, error: invoiceError } = await db
      .from("invoices")
      .select("id,organization_id,customer_id,invoice_number,status,total,stripe_checkout_session_id")
      .eq("id", invoiceId)
      .single();
    if (invoiceError || !invoice) return failure("Invoice not found.", 404);

    const companyId = String(invoice.organization_id || "");
    const [{ data: profile }, { data: customer }] = await Promise.all([
      db.from("profiles").select("role,active,company_id,organization_id").eq("id", auth.user.id).maybeSingle(),
      db.from("customers").select("id,profile_id,email,full_name,acquisition_source,platform_managed,origin_company_id,service_company_id,company_id,organization_id,archived_at").eq("id", invoice.customer_id).maybeSingle()
    ]);
    await requireManagerFinancePermission(token, profile);
    if (!invoiceAccessAllowed(profile, customer, auth.user.id, companyId)) {
      return failure("You cannot pay this invoice.", 403);
    }

    if (invoice.status === "processing" && invoice.stripe_checkout_session_id) {
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
      const currentSession = await stripe.checkout.sessions.retrieve(invoice.stripe_checkout_session_id);
      if (currentSession.payment_status === "paid") {
        return failure("This invoice payment is already being confirmed.", 409);
      }
      if (currentSession.status === "open" && currentSession.url) {
        return NextResponse.json({ url: currentSession.url, reused: true });
      }
      const reset = await db
        .from("invoices")
        .update({ status: "waiting_payment" })
        .eq("id", invoice.id)
        .eq("status", "processing");
      if (reset.error) throw new Error(reset.error.message);
    } else if (!["sent", "waiting_payment", "overdue"].includes(String(invoice.status))) {
      return failure("This invoice is not open for card payment.", 409);
    }
    const cents = Math.round(Number(invoice.total) * 100);
    if (!Number.isSafeInteger(cents) || cents < 50) return failure("This invoice has no valid amount to charge.", 409);

    const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
    const transferGroup = `invoice-${invoice.id}`;
    const metadata = { invoiceId: invoice.id, companyId, customerId: invoice.customer_id || "", requestDescription: String(body.description || "").slice(0, 400) };
    const origin = checkoutOrigin(request);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customer?.email || auth.user.email || undefined,
      line_items: [{ quantity: 1, price_data: { currency: "cad", unit_amount: cents, product_data: { name: String(body.description || "").trim() || `Invoice ${invoice.invoice_number}` } } }],
      metadata,
      payment_intent_data: { metadata, transfer_group: transferGroup },
      success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/payment/cancel?invoiceId=${invoice.id}`
    }, {
      idempotencyKey: `checkout-${invoice.id}-${cents}-${invoice.stripe_checkout_session_id || "initial"}`
    });

    const stripeUpdate = await db.from("invoices").update({
      stripe_checkout_session_id: session.id,
      stripe_transfer_group: transferGroup,
      status: "processing"
    }).eq("id", invoice.id);
    if (stripeUpdate.error) throw new Error(stripeUpdate.error.message);

    return NextResponse.json({ url: session.url, ...createdManualInvoice });
  } catch (error) {
    console.error("Stripe checkout failed", error);
    const message = error instanceof Error ? error.message : "Could not start card checkout.";
    const status = /session expired|sign in/i.test(message) ? 401 : /permission|finance|cannot receive|cannot pay/i.test(message) ? 403 : 500;
    return failure(status === 500 ? "Could not start card checkout." : message, status);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!url || !serviceKey || !stripeKey) return failure("Card payments are not available yet.", 503);

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return failure("Sign in before cancelling checkout.", 401);

    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return failure("Your session expired. Sign in again.", 401);

    const body = (await request.json()) as { invoiceId?: string };
    const invoiceId = String(body.invoiceId || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(invoiceId)) return failure("Choose a valid invoice.", 400);

    const { data: invoice, error: invoiceError } = await db
      .from("invoices")
      .select("id,organization_id,customer_id,status,stripe_checkout_session_id")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invoiceError || !invoice) return failure("Invoice not found.", 404);

    const companyId = String(invoice.organization_id || "");
    const [{ data: profile }, { data: customer }] = await Promise.all([
      db.from("profiles").select("role,active,company_id,organization_id").eq("id", auth.user.id).maybeSingle(),
      db.from("customers").select("profile_id,acquisition_source,platform_managed,origin_company_id,service_company_id,company_id,organization_id,archived_at").eq("id", invoice.customer_id).maybeSingle()
    ]);
    await requireManagerFinancePermission(token, profile);
    if (!invoiceAccessAllowed(profile, customer, auth.user.id, companyId)) {
      return failure("You cannot cancel this checkout.", 403);
    }

    if (invoice.status !== "processing") return NextResponse.json({ cancelled: false });

    if (invoice.stripe_checkout_session_id) {
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
      const session = await stripe.checkout.sessions.retrieve(invoice.stripe_checkout_session_id);
      if (session.payment_status === "paid") {
        return failure("This payment is already being confirmed.", 409);
      }
      if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
    }

    const reset = await db
      .from("invoices")
      .update({ status: "waiting_payment" })
      .eq("id", invoice.id)
      .eq("status", "processing");
    if (reset.error) throw new Error(reset.error.message);

    return NextResponse.json({ cancelled: true });
  } catch (error) {
    console.error("Stripe checkout cancellation failed", error);
    const message = error instanceof Error ? error.message : "Could not cancel card checkout.";
    const status = /session expired|sign in/i.test(message) ? 401 : /permission|finance|cannot cancel/i.test(message) ? 403 : 500;
    return failure(status === 500 ? "Could not cancel card checkout." : message, status);
  }
}
