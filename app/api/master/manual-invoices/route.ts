import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { sendBrandedEmail } from "@/lib/server/brandedEmail";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  customerId: z.string().uuid(),
  visitId: z.string().uuid(),
  amountCents: z.number().int().min(50).max(1_000_000),
  description: z.string().trim().min(8).max(500),
  sendEmail: z.boolean().default(false),
}).strict();

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Master billing is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const db = serverClient();
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Master session expired. Sign in again.");
  const { data: profile, error } = await db.from("profiles").select("id,role,active").eq("id", auth.user.id).maybeSingle();
  if (error || !profile?.active || profile.role !== "master") throw new Error("Only an active Master can create manual customer invoices.");
  return { db, masterId: auth.user.id };
}

function fail(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Master billing request failed." }, { status });
}

function money(cents: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

function niceDate(value?: string | null) {
  if (!value) return "—";
  return new Date(`${value.length === 10 ? `${value}T12:00:00` : value}`).toLocaleDateString("en-CA", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function invoiceNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `MINV-${stamp}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

async function loadWorkspace(db: any, customerId?: string | null) {
  const [{ data: companies, error: companyError }, { data: customers, error: customerError }] = await Promise.all([
    db.from("organizations").select("id,name,active").is("deleted_at", null).order("name"),
    db.from("customers")
      .select("id,full_name,email,company_id,organization_id,origin_company_id,service_company_id,platform_managed,acquisition_source,archived_at")
      .is("archived_at", null)
      .order("full_name"),
  ]);
  if (companyError) throw new Error(companyError.message);
  if (customerError) throw new Error(customerError.message);
  const companyNames = new Map((companies || []).map((row: any) => [String(row.id), String(row.name || "Company")]));
  const normalizedCustomers = (customers || []).map((row: any) => {
    const companyId = String(row.service_company_id || row.company_id || row.organization_id || row.origin_company_id || "");
    return {
      id: row.id,
      name: row.full_name || "Customer",
      email: row.email || null,
      companyId: companyId || null,
      companyName: companyId ? companyNames.get(companyId) || "Company" : "Platform / unassigned",
      platformManaged: row.platform_managed === true || row.acquisition_source === "platform",
    };
  });

  if (!customerId) return { companies: companies || [], customers: normalizedCustomers, visits: [], invoices: [] };
  const customer = normalizedCustomers.find((row: any) => row.id === customerId);
  if (!customer) throw new Error("Customer not found.");

  const visitsResult = await db.from("visits")
    .select("id,customer_id,property_id,job_id,scheduled_date,status,started_at,finished_at")
    .eq("customer_id", customerId)
    .order("scheduled_date", { ascending: false })
    .limit(80);
  if (visitsResult.error) throw new Error(visitsResult.error.message);
  const visits = visitsResult.data || [];
  const jobIds = Array.from(new Set(visits.map((row: any) => row.job_id).filter(Boolean)));
  const propertyIds = Array.from(new Set(visits.map((row: any) => row.property_id).filter(Boolean)));
  const [jobsResult, propertiesResult, invoicesResult] = await Promise.all([
    jobIds.length ? db.from("jobs").select("id,service_name").in("id", jobIds) : Promise.resolve({ data: [], error: null }),
    propertyIds.length ? db.from("properties").select("id,address_line1,city,province").in("id", propertyIds) : Promise.resolve({ data: [], error: null }),
    db.from("invoices")
      .select("id,invoice_number,status,total,visit_id,manual_description,created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (jobsResult.error) throw new Error(jobsResult.error.message);
  if (propertiesResult.error) throw new Error(propertiesResult.error.message);
  if (invoicesResult.error) throw new Error(invoicesResult.error.message);
  const jobNames = new Map((jobsResult.data || []).map((row: any) => [String(row.id), String(row.service_name || "Property maintenance")]));
  const addresses = new Map((propertiesResult.data || []).map((row: any) => [
    String(row.id),
    [row.address_line1, row.city, row.province].filter(Boolean).join(", "),
  ]));

  return {
    companies: companies || [],
    customers: normalizedCustomers,
    visits: visits.map((row: any) => ({
      id: row.id,
      date: row.scheduled_date,
      status: row.status,
      serviceName: jobNames.get(String(row.job_id || "")) || "Property maintenance",
      address: addresses.get(String(row.property_id || "")) || "Property",
      propertyId: row.property_id || null,
      jobId: row.job_id || null,
      startedAt: row.started_at || null,
      finishedAt: row.finished_at || null,
    })),
    invoices: invoicesResult.data || [],
  };
}

export async function GET(request: NextRequest) {
  try {
    const { db } = await requireMaster(request);
    const customerId = request.nextUrl.searchParams.get("customerId");
    if (customerId && !z.string().uuid().safeParse(customerId).success) return fail(new Error("Choose a valid customer."), 400);
    return NextResponse.json(await loadWorkspace(db, customerId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Master billing could not be loaded.";
    const status = /session expired|sign in/i.test(message) ? 401 : /Only an active Master/i.test(message) ? 403 : 400;
    return fail(error, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createSchema.parse(await request.json());
    const { db, masterId } = await requireMaster(request);
    const [{ data: customer, error: customerError }, { data: visit, error: visitError }] = await Promise.all([
      db.from("customers")
        .select("id,full_name,email,company_id,organization_id,origin_company_id,service_company_id,archived_at")
        .eq("id", body.customerId)
        .maybeSingle(),
      db.from("visits")
        .select("id,customer_id,property_id,job_id,scheduled_date,status")
        .eq("id", body.visitId)
        .maybeSingle(),
    ]);
    if (customerError || !customer || customer.archived_at) throw new Error(customerError?.message || "Customer is unavailable.");
    if (visitError || !visit || String(visit.customer_id) !== body.customerId) throw new Error(visitError?.message || "Selected Visit does not belong to this customer.");
    if (String(visit.status) !== "completed") throw new Error("Manual invoices can only be linked to a completed Visit.");

    const companyId = String(customer.service_company_id || customer.company_id || customer.organization_id || customer.origin_company_id || "");
    if (!z.string().uuid().safeParse(companyId).success) throw new Error("This customer is not connected to a billing company.");
    const [{ data: company, error: companyError }, { data: job, error: jobError }] = await Promise.all([
      db.from("organizations").select("id,name").eq("id", companyId).maybeSingle(),
      visit.job_id ? db.from("jobs").select("id,service_name").eq("id", visit.job_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (companyError || !company) throw new Error(companyError?.message || "Billing company could not be loaded.");
    if (jobError) throw new Error(jobError.message);

    const total = body.amountCents / 100;
    const payload = {
      organization_id: companyId,
      company_id: companyId,
      customer_id: customer.id,
      property_id: visit.property_id || null,
      visit_id: visit.id,
      invoice_number: invoiceNumber(),
      status: "waiting_payment",
      subtotal: total,
      tax: 0,
      total,
      manual_description: body.description,
      manual_created_by_profile_id: masterId,
    };
    const created = await db.from("invoices").insert(payload).select("id,invoice_number,status,total,created_at").single();
    if (created.error || !created.data) throw new Error(created.error?.message || "Invoice could not be created.");

    const rootUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.4everseasons.com").replace(/\/$/, "");
    let emailSent = false;
    let emailError: string | null = null;
    if (body.sendEmail) {
      if (!customer.email) {
        emailError = "Customer email is missing.";
      } else {
        emailSent = await sendBrandedEmail({
          to: customer.email,
          subject: `4 Ever Seasons — Invoice ${created.data.invoice_number}`,
          eyebrow: "Service adjustment invoice",
          title: "A service invoice is ready for review",
          intro: `Hello ${customer.full_name || "there"}. A Master-reviewed invoice was created for a completed service Visit. Review the details before paying securely.`,
          highlight: { label: "Amount due", value: money(body.amountCents), note: `Visit ${niceDate(visit.scheduled_date)}` },
          sectionTitle: "Invoice details",
          details: [
            { label: "Invoice", value: String(created.data.invoice_number) },
            { label: "Company", value: String(company.name || "4 Ever Seasons service partner") },
            { label: "Service", value: String(job?.service_name || "Property maintenance") },
            { label: "Visit", value: niceDate(visit.scheduled_date) },
            { label: "Reason", value: body.description },
            { label: "Total", value: money(body.amountCents) },
          ],
          cta: { label: "View & pay invoice", href: `${rootUrl}/customer/invoices/${created.data.id}` },
          footer: "4 Ever Seasons · Secure Master-reviewed customer billing",
        });
        if (!emailSent) emailError = "Email provider did not confirm delivery.";
      }

      const notificationUpdate = await db.from("invoices").update({
        customer_notification_attempted_at: new Date().toISOString(),
        customer_notified_at: emailSent ? new Date().toISOString() : null,
        customer_notification_error: emailError,
      }).eq("id", created.data.id);
      if (notificationUpdate.error) console.error("Manual invoice notification status could not be recorded", notificationUpdate.error);
    }

    const audit = await db.from("master_audit_log").insert({
      master_profile_id: masterId,
      company_id: companyId,
      action: body.sendEmail ? "invoice.manual_created_and_sent" : "invoice.manual_created",
      entity_type: "invoice",
      entity_id: created.data.id,
      details: {
        customer_id: customer.id,
        visit_id: visit.id,
        amount_cents: body.amountCents,
        description: body.description,
        email_sent: emailSent,
        email_error: emailError,
      },
    });
    if (audit.error) throw new Error(`Invoice created but audit logging failed: ${audit.error.message}`);

    return NextResponse.json({
      created: true,
      invoice: created.data,
      emailSent,
      emailError,
      invoiceUrl: `${rootUrl}/customer/invoices/${created.data.id}`,
    });
  } catch (error) {
    console.error("Master manual invoice failed", error);
    const message = error instanceof Error ? error.message : "Manual invoice could not be created.";
    const status = /session expired|sign in/i.test(message) ? 401 : /Only an active Master/i.test(message) ? 403 : /completed Visit|not connected|does not belong/i.test(message) ? 409 : 400;
    return fail(error, status);
  }
}
