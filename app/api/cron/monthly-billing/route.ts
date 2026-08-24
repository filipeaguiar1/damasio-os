import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendBrandedEmail } from "@/lib/server/brandedEmail";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function niceDate(value?: string | null) {
  if (!value) return "—";
  return new Date(`${value.length === 10 ? `${value}T12:00:00` : value}`).toLocaleDateString("en-CA", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Monthly billing CRON_SECRET is not configured." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Monthly billing database access is not configured." }, { status: 503 });
  }

  try {
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await db.rpc("materialize_due_monthly_billing_cycles", {
      p_reference_date: today,
      p_limit: 1000,
    });
    if (error) throw new Error(error.message);

    const pendingNotifications = await db
      .from("invoices")
      .select("id,invoice_number,status,total,subtotal,tax,customer_id,billing_cycle_id,created_at")
      .not("billing_cycle_id", "is", null)
      .is("customer_notified_at", null)
      .in("status", ["waiting_payment", "overdue"])
      .order("created_at", { ascending: true })
      .limit(50);
    if (pendingNotifications.error) throw new Error(pendingNotifications.error.message);

    let invoiceEmailsSent = 0;
    let invoiceEmailFailures = 0;
    const rootUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.4everseasons.com").replace(/\/$/, "");

    for (const invoice of pendingNotifications.data || []) {
      try {
        const [{ data: customer, error: customerError }, { data: cycle, error: cycleError }] = await Promise.all([
          db.from("customers").select("id,full_name,email").eq("id", invoice.customer_id).maybeSingle(),
          db.from("billing_cycles").select("id,job_id,period_starts_on,period_ends_on,charge_due_on").eq("id", invoice.billing_cycle_id).maybeSingle(),
        ]);
        if (customerError) throw new Error(customerError.message);
        if (cycleError) throw new Error(cycleError.message);
        if (!customer?.email) throw new Error("Customer email is missing.");

        let serviceName = "Monthly property maintenance plan";
        if (cycle?.job_id) {
          const { data: job, error: jobError } = await db.from("jobs").select("service_name").eq("id", cycle.job_id).maybeSingle();
          if (jobError) throw new Error(jobError.message);
          if (job?.service_name) serviceName = job.service_name;
        }

        const sent = await sendBrandedEmail({
          to: customer.email,
          subject: `4 Ever Seasons — Invoice ${invoice.invoice_number}`,
          eyebrow: "Monthly invoice",
          title: `Your ${serviceName} invoice is ready`,
          intro: `Hello ${customer.full_name || "there"}. Your monthly property maintenance invoice is ready in your secure 4 Ever Seasons account. Individual service Visits in this period are not charged separately.`,
          highlight: {
            label: "Amount due",
            value: money(Number(invoice.total || 0)),
            note: cycle?.charge_due_on ? `Due ${niceDate(cycle.charge_due_on)}` : "Secure payment is available in your customer account.",
          },
          sectionTitle: "Invoice details",
          details: [
            { label: "Invoice", value: String(invoice.invoice_number || "") },
            { label: "Service", value: serviceName },
            { label: "Billing period", value: cycle ? `${niceDate(cycle.period_starts_on)} – ${niceDate(cycle.period_ends_on)}` : "Monthly" },
            { label: "Subtotal", value: money(Number(invoice.subtotal || 0)) },
            { label: "Tax", value: money(Number(invoice.tax || 0)) },
            { label: "Total", value: money(Number(invoice.total || 0)) },
          ],
          cta: { label: "View & pay invoice", href: `${rootUrl}/customer/invoices/${invoice.id}` },
          footer: "4 Ever Seasons · Secure monthly property maintenance billing",
        });
        if (!sent) throw new Error("Invoice email provider did not confirm delivery.");

        const updated = await db.from("invoices").update({
          customer_notified_at: new Date().toISOString(),
          customer_notification_attempted_at: new Date().toISOString(),
          customer_notification_error: null,
        }).eq("id", invoice.id);
        if (updated.error) throw new Error(updated.error.message);
        invoiceEmailsSent += 1;
      } catch (emailError) {
        invoiceEmailFailures += 1;
        const detail = emailError instanceof Error ? emailError.message : "Invoice email failed.";
        const failedUpdate = await db.from("invoices").update({
          customer_notification_attempted_at: new Date().toISOString(),
          customer_notification_error: detail.slice(0, 500),
        }).eq("id", invoice.id);
        if (failedUpdate.error) console.error("Could not record invoice email failure", failedUpdate.error);
      }
    }

    const [{ count: openInvoices, error: invoiceError }, { count: failedCycles, error: cycleError }] = await Promise.all([
      db.from("invoices").select("id", { count: "exact", head: true }).in("status", ["waiting_payment", "overdue"]),
      db.from("billing_cycles").select("id", { count: "exact", head: true }).eq("state", "payment_failed"),
    ]);
    if (invoiceError) throw new Error(invoiceError.message);
    if (cycleError) throw new Error(cycleError.message);

    return NextResponse.json({
      ok: true,
      billingDate: today,
      materialized: data || {},
      invoiceEmailsSent,
      invoiceEmailFailures,
      openInvoices: openInvoices || 0,
      failedCycles: failedCycles || 0,
    });
  } catch (error) {
    console.error("Monthly billing cron failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Monthly billing cron failed." }, { status: 500 });
  }
}
