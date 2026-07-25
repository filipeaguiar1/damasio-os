import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Customer billing is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return failure("Sign in to view invoices.", 401);
    const db = serverClient();
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return failure("Your session expired. Sign in again.", 401);

    const { data: profile } = await db.from("profiles").select("id,role,active,company_id,organization_id").eq("id", auth.user.id).maybeSingle();
    if (!profile?.active) return failure("Your customer account is not active.", 403);

    let customer = null;
    const byProfile = await db.from("customers").select("id,company_id,organization_id,profile_id,email").eq("profile_id", auth.user.id).is("archived_at", null).maybeSingle();
    if (!byProfile.error) customer = byProfile.data;

    if (!customer && auth.user.user_metadata?.customer_id) {
      const byMetadata = await db.from("customers").select("id,company_id,organization_id,profile_id,email").eq("id", auth.user.user_metadata.customer_id).is("archived_at", null).maybeSingle();
      if (!byMetadata.error) customer = byMetadata.data;
    }

    if (!customer && auth.user.email) {
      const byEmail = await db.from("customers").select("id,company_id,organization_id,profile_id,email").ilike("email", auth.user.email.trim()).is("archived_at", null).limit(1).maybeSingle();
      if (!byEmail.error) customer = byEmail.data;
    }

    if (!customer) return NextResponse.json({ invoices: [], linked: false });

    if (!customer.profile_id) {
      const linked = await db.from("customers").update({ profile_id: auth.user.id }).eq("id", customer.id).is("profile_id", null).select("id,company_id,organization_id,profile_id,email").maybeSingle();
      if (!linked.error && linked.data) customer = linked.data;
    }

    const [serviceInvoicesResult, depositInvoicesResult] = await Promise.all([
      db
        .from("invoices")
        .select("id,invoice_number,status,total,subtotal,tax,created_at,quote_id,customer_id,property_id,quotes(quote_number,status,notes,request_id,service_requests(service_name))")
        .eq("customer_id", customer.id),
      db
        .from("customer_deposit_invoices")
        .select("id,invoice_number,status,amount_cents,created_at")
        .eq("customer_id", customer.id),
    ]);

    if (serviceInvoicesResult.error) throw new Error(serviceInvoicesResult.error.message);
    if (depositInvoicesResult.error) throw new Error(depositInvoicesResult.error.message);

    const serviceInvoices = (serviceInvoicesResult.data || []).map((invoice: any) => {
      const quote = Array.isArray(invoice.quotes) ? invoice.quotes[0] : invoice.quotes;
      const serviceRequest = Array.isArray(quote?.service_requests) ? quote.service_requests[0] : quote?.service_requests;
      return {
        id: invoice.id,
        number: invoice.invoice_number,
        status: invoice.status,
        total: Number(invoice.total || 0),
        subtotal: Number(invoice.subtotal || 0),
        tax: Number(invoice.tax || 0),
        createdAt: invoice.created_at,
        quoteNumber: quote?.quote_number || null,
        quoteStatus: quote?.status || null,
        service: serviceRequest?.service_name || quote?.notes || "Approved service",
        kind: "service",
      };
    });

    const depositInvoices = (depositInvoicesResult.data || []).map((invoice: any) => ({
      id: invoice.id,
      number: invoice.invoice_number,
      status: invoice.status,
      total: Number(invoice.amount_cents || 0) / 100,
      subtotal: Number(invoice.amount_cents || 0) / 100,
      tax: 0,
      createdAt: invoice.created_at,
      quoteNumber: null,
      quoteStatus: null,
      service: "Account deposit",
      kind: "deposit",
    }));

    const invoices = [...serviceInvoices, ...depositInvoices]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({
      linked: customer.profile_id === auth.user.id,
      invoices,
    });
  } catch (error) {
    console.error("Customer invoices failed", error);
    return failure(error instanceof Error ? error.message : "Invoices could not be loaded.", 500);
  }
}
