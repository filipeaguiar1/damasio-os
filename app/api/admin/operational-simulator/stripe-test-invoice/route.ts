import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Operational simulator is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function simulationPattern(companyId: string) {
  return `ops-sim-${companyId.slice(0, 8)}-%@4everseasons.test`;
}

async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");

  const service = serviceClient();
  const auth = await service.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error("Your Admin session expired. Sign in again.");

  const profile = await service.from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.data.user.id)
    .single();
  if (profile.error || !profile.data?.active || !["admin", "manager"].includes(String(profile.data.role))) {
    throw new Error("Only an active company Admin can create the Stripe QA invoice.");
  }

  const companyId = String(profile.data.company_id || profile.data.organization_id || "");
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service, companyId };
}

export async function POST(request: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY || "";
    if (!stripeKey.startsWith("sk_test_")) {
      return failure("Stripe QA is disabled because this deployment is not using a Stripe test key.", 409);
    }
    if (process.env.VERCEL_ENV === "production") {
      return failure("Stripe QA invoices cannot be created in the production environment.", 403);
    }

    const { service, companyId } = await requireAdmin(request);
    const customerResult = await service.from("customers")
      .select("id,profile_id,email,full_name")
      .or(companyFilter(companyId))
      .like("email", simulationPattern(companyId))
      .not("profile_id", "is", null)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (customerResult.error) throw new Error(customerResult.error.message);
    const customer = customerResult.data;
    if (!customer) throw new Error("Create the two-month simulation before creating a Stripe QA invoice.");

    const propertyResult = await service.from("properties")
      .select("id")
      .eq("customer_id", customer.id)
      .or(companyFilter(companyId))
      .limit(1)
      .maybeSingle();
    if (propertyResult.error || !propertyResult.data) throw new Error(propertyResult.error?.message || "Simulation property was not found.");

    const quoteResult = await service.from("quotes")
      .select("id")
      .eq("customer_id", customer.id)
      .or(companyFilter(companyId))
      .limit(1)
      .maybeSingle();
    if (quoteResult.error || !quoteResult.data) throw new Error(quoteResult.error?.message || "Simulation quote was not found.");

    const invoiceNumber = `SIM-STRIPE-${String(customer.id).slice(0, 8).toUpperCase()}`;
    const existing = await service.from("invoices")
      .select("id,invoice_number,status,total")
      .eq("customer_id", customer.id)
      .eq("invoice_number", invoiceNumber)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) {
      return NextResponse.json({ created: false, invoice: existing.data, customer });
    }

    const invoice = {
      id: randomUUID(),
      organization_id: companyId,
      company_id: companyId,
      quote_id: quoteResult.data.id,
      customer_id: customer.id,
      property_id: propertyResult.data.id,
      invoice_number: invoiceNumber,
      status: "waiting_payment",
      subtotal: 40,
      tax: 5.2,
      total: 45.2,
      created_at: new Date().toISOString(),
    };

    let inserted = await service.from("invoices").insert(invoice).select("id,invoice_number,status,total").single();
    if (inserted.error && /company_id|schema cache|does not exist/i.test(inserted.error.message)) {
      const { company_id: _companyId, ...legacyInvoice } = invoice;
      inserted = await service.from("invoices").insert(legacyInvoice).select("id,invoice_number,status,total").single();
    }
    if (inserted.error) throw new Error(inserted.error.message);

    return NextResponse.json({
      created: true,
      invoice: inserted.data,
      customer,
      message: "Stripe test-mode invoice created for the featured simulation Customer.",
    }, { status: 201 });
  } catch (error) {
    console.error("stripe-test-invoice", error);
    return failure(error instanceof Error ? error.message : "Stripe QA invoice could not be created.", 400);
  }
}
