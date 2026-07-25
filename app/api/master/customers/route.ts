import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Master customer management is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error } = await client.from("profiles").select("id,role,active").eq("id", auth.user.id).maybeSingle();
  if (error || !profile?.active || profile.role !== "master") throw new Error("Only an active Master can manage customer assignment.");
  return { client, masterId: auth.user.id };
}

function fail(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Customer request failed." }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { client } = await requireMaster(request);
    const customerId = request.nextUrl.searchParams.get("id");

    if (customerId) {
      const { data: customer, error } = await client
        .from("customers")
        .select("id,full_name,email,phone,created_at,profile_id,acquisition_source,origin_company_id,service_company_id,referral_code_used,assignment_status,first_payment_at,last_transfer_at,last_transfer_reason,previous_service_company_id,previous_company_notified_at")
        .eq("id", customerId)
        .maybeSingle();
      if (error || !customer) throw new Error(error?.message || "Customer not found.");

      const [quotes, invoices, payments, companies] = await Promise.all([
        client.from("quotes").select("id,quote_number,status,subtotal,tax,total,created_at,origin_company_id,referral_code_used,revision_note").eq("customer_id", customerId).order("created_at", { ascending: false }),
        client.from("invoices").select("id,invoice_number,status,subtotal,tax,total,created_at,paid_at").eq("customer_id", customerId).order("created_at", { ascending: false }),
        client.from("payments").select("id,status,amount,provider,provider_reference,failure_code,failure_message,created_at").eq("customer_id", customerId).order("created_at", { ascending: false }),
        client.from("organizations").select("id,name,active,referral_code").is("deleted_at", null).order("name"),
      ]);

      return NextResponse.json({
        customer,
        quotes: quotes.data || [],
        invoices: invoices.data || [],
        payments: payments.data || [],
        companies: companies.data || [],
        warnings: [quotes.error, invoices.error, payments.error, companies.error].filter(Boolean).map((item) => item!.message),
      });
    }

    const { data, error } = await client
      .from("customers")
      .select("id,full_name,email,phone,created_at,acquisition_source,origin_company_id,service_company_id,referral_code_used,assignment_status,first_payment_at,last_transfer_at")
      .in("assignment_status", ["pending_payment", "ready_for_assignment", "assigned"])
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const companyIds = Array.from(new Set((data || []).flatMap((row) => [row.origin_company_id, row.service_company_id]).filter(Boolean))) as string[];
    const { data: companies } = companyIds.length
      ? await client.from("organizations").select("id,name").in("id", companyIds)
      : { data: [] as Array<{ id: string; name: string }> };
    const names = new Map((companies || []).map((company) => [company.id, company.name]));

    return NextResponse.json({
      customers: (data || []).map((customer) => ({
        ...customer,
        originCompanyName: customer.origin_company_id ? names.get(customer.origin_company_id) || "Unknown company" : null,
        serviceCompanyName: customer.service_company_id ? names.get(customer.service_company_id) || "Unknown company" : null,
        companyOriginAlert: customer.acquisition_source === "company_referral" || customer.acquisition_source === "company_created",
      })),
    });
  } catch (error) {
    return fail(error, 401);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { client, masterId } = await requireMaster(request);
    const body = await request.json() as { customerId?: string; serviceCompanyId?: string | null; reason?: string };
    if (!body.customerId) throw new Error("Choose a customer.");

    const { data, error } = await client.rpc("master_transfer_customer", {
      p_customer_id: body.customerId,
      p_service_company_id: body.serviceCompanyId || null,
      p_reason: body.reason || null,
    });
    if (error || !data) throw new Error(error?.message || "Customer could not be transferred.");

    await client.from("master_audit_log").insert({
      master_profile_id: masterId,
      company_id: body.serviceCompanyId || null,
      action: body.serviceCompanyId ? "customer.service_company_changed" : "customer.returned_to_assignment_queue",
      entity_type: "customer",
      entity_id: body.customerId,
      details: { reason: body.reason || null, origin_company_id: data.origin_company_id, previous_service_company_id: data.previous_service_company_id },
    });

    return NextResponse.json({
      customer: data,
      message: body.serviceCompanyId
        ? "Customer service company updated. Commercial origin was preserved."
        : "Customer returned to the Master assignment queue. Commercial origin was preserved.",
    });
  } catch (error) {
    return fail(error);
  }
}
