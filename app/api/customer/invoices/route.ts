import { NextRequest, NextResponse } from "next/server";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { service: db, customer, identity } = await requireCustomerPortalIdentity(request, { allowUnlinked: true });
    if (!customer || !identity.customerId) return NextResponse.json({ invoices: [], linked: false });

    let serviceInvoicesQuery = db
      .from("invoices")
      .select("id,invoice_number,status,total,subtotal,tax,created_at,quote_id,customer_id,property_id,quotes(quote_number,status,notes,request_id,service_requests(service_name))")
      .eq("customer_id", identity.customerId);
    if (identity.companyId) {
      serviceInvoicesQuery = serviceInvoicesQuery.or(`company_id.eq.${identity.companyId},organization_id.eq.${identity.companyId}`);
    }

    const [serviceInvoicesResult, depositInvoicesResult] = await Promise.all([
      serviceInvoicesQuery,
      db
        .from("customer_deposit_invoices")
        .select("id,invoice_number,status,amount_cents,created_at")
        .eq("customer_id", identity.customerId),
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

    return NextResponse.json({ linked: true, invoices });
  } catch (error) {
    console.error("Customer invoices failed", error);
    const message = error instanceof Error ? error.message : "Invoices could not be loaded.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active/i.test(message) ? 403 : 500;
    return failure(message, status);
  }
}
