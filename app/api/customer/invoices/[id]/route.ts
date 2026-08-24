import { NextRequest, NextResponse } from "next/server";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!uuid(id)) return failure("Invoice not found.", 404);

    const { service: db, customer, identity } = await requireCustomerPortalIdentity(request);
    if (!customer || !identity.customerId) return failure("Customer account is not linked yet.", 403);

    const invoiceResult = await db
      .from("invoices")
      .select("id,organization_id,customer_id,property_id,quote_id,invoice_number,status,subtotal,tax,total,created_at,stripe_payment_intent_id,billing_cycle_id,visit_id,billing_event_id,manual_description")
      .eq("id", id)
      .eq("customer_id", identity.customerId)
      .maybeSingle();
    if (invoiceResult.error) throw new Error(invoiceResult.error.message);
    if (!invoiceResult.data) return failure("Invoice not found for this customer.", 404);
    const invoice = invoiceResult.data as any;

    const [organizationResult, propertyResult, paymentResult, cycleResult, quoteResult, visitResult] = await Promise.all([
      invoice.organization_id
        ? db.from("organizations").select("id,name").eq("id", invoice.organization_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      invoice.property_id
        ? db.from("properties").select("id,address_line1,city,province,postal_code").eq("id", invoice.property_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db.from("payments")
        .select("id,status,method,amount,paid_at,stripe_payment_intent_id")
        .eq("invoice_id", invoice.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      invoice.billing_cycle_id
        ? db.from("billing_cycles")
            .select("id,billing_agreement_id,job_id,period_starts_on,period_ends_on,charge_due_on,state")
            .eq("id", invoice.billing_cycle_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      invoice.quote_id
        ? db.from("quotes")
            .select("id,quote_number,notes,request_id,service_requests(service_name)")
            .eq("id", invoice.quote_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      invoice.visit_id
        ? db.from("visits").select("id,job_id,scheduled_date,status").eq("id", invoice.visit_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    for (const result of [organizationResult, propertyResult, paymentResult, cycleResult, quoteResult, visitResult]) {
      if ((result as any).error) throw new Error((result as any).error.message);
    }

    const cycle = cycleResult.data as any;
    const visit = visitResult.data as any;
    const jobId = cycle?.job_id || visit?.job_id || null;
    let job: any = null;
    if (jobId) {
      const jobResult = await db.from("jobs").select("id,service_name,frequency,service_frequency").eq("id", jobId).maybeSingle();
      if (jobResult.error) throw new Error(jobResult.error.message);
      job = jobResult.data;
    }

    const quote = quoteResult.data as any;
    const serviceRequest = Array.isArray(quote?.service_requests) ? quote.service_requests[0] : quote?.service_requests;
    const serviceName = invoice.manual_description
      || job?.service_name
      || serviceRequest?.service_name
      || quote?.notes
      || (cycle ? "Monthly property maintenance plan" : "Property maintenance service");
    const property = propertyResult.data as any;
    const payment = paymentResult.data as any;
    const jobFrequency = String(job?.service_frequency || job?.frequency || "").toLowerCase();
    const cadence: "monthly" | "per_visit" | "one_time" = cycle
      ? "monthly"
      : invoice.manual_description
        ? "one_time"
        : ["weekly", "biweekly", "custom"].includes(jobFrequency)
          ? "per_visit"
          : "one_time";

    return NextResponse.json({
      invoice: {
        id: invoice.id,
        number: invoice.invoice_number,
        status: invoice.status,
        subtotal: Number(invoice.subtotal || 0),
        tax: Number(invoice.tax || 0),
        total: Number(invoice.total || 0),
        createdAt: invoice.created_at,
        serviceName,
        manualDescription: invoice.manual_description || null,
        cadence,
        periodStartsOn: cycle?.period_starts_on || null,
        periodEndsOn: cycle?.period_ends_on || null,
        dueOn: cycle?.charge_due_on || null,
        visit: visit ? { id: visit.id, date: visit.scheduled_date || null, status: visit.status || null } : null,
        company: {
          name: organizationResult.data?.name || "4 Ever Seasons service partner",
        },
        customer: {
          name: customer.full_name || "Customer",
          email: customer.email || null,
          phone: customer.phone || null,
        },
        property: property ? {
          addressLine1: property.address_line1 || null,
          city: property.city || null,
          province: property.province || null,
          postalCode: property.postal_code || null,
        } : null,
        payment: payment ? {
          status: payment.status,
          method: payment.method,
          amount: Number(payment.amount || 0),
          paidAt: payment.paid_at || null,
          stripePaymentIntentId: payment.stripe_payment_intent_id || null,
        } : null,
      },
    });
  } catch (error) {
    console.error("Customer invoice detail failed", error);
    const message = error instanceof Error ? error.message : "Invoice could not be loaded.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active|linked/i.test(message) ? 403 : 500;
    return failure(message, status);
  }
}
