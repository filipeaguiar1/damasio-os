import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const ownerId = process.env.FOREVER_OWNER_USER_ID;
  const companyId = process.env.FOREVER_COMPANY_ID;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ownerId || !companyId || !url || !key) return response("Owner workspace is not configured.", 503);
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return response("Sign in to view your workspace.", 401);

  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return response("Your session has expired.", 401);
    if (auth.user.id !== ownerId) return response("This workspace is private.", 403);

    const { data: profile, error: profileError } = await db.from("profiles")
      .select("active, role").eq("id", auth.user.id).maybeSingle();
    if (profileError || !profile?.active || !["admin", "master"].includes(profile.role)) {
      return response("Your owner account is not active.", 403);
    }

    const [customers, properties, invoices, payments, visits, photos, requests] = await Promise.all([
      db.from("customers").select("id,full_name,email,phone,notes,created_at")
        .eq("organization_id", companyId).is("archived_at", null).order("created_at", { ascending: false }).limit(400),
      db.from("properties").select("id,customer_id,address_line1,city,province,postal_code")
        .eq("organization_id", companyId).limit(800),
      db.from("invoices").select("id,customer_id,invoice_number,manual_description,created_at,status,total")
        .eq("organization_id", companyId).order("created_at", { ascending: false }).limit(1000),
      db.from("payments").select("id,customer_id,invoice_id,amount,method,status,paid_at,created_at,reference")
        .eq("organization_id", companyId).order("created_at", { ascending: false }).limit(1000),
      db.from("visits").select("id,customer_id,property_id,scheduled_date,status,finished_at,customer_visible_summary,employee_notes")
        .eq("organization_id", companyId).order("scheduled_date", { ascending: false }).limit(1000),
      db.from("photos").select("id,property_id,visit_id,storage_bucket,storage_path,photo_type,caption,created_at")
        .eq("organization_id", companyId).order("created_at", { ascending: false }).limit(500),
      db.from("lead_center").select("id,full_name,email,phone,address,service_requested,notes,status,created_at")
        .eq("assigned_company_id", companyId).order("created_at", { ascending: false }).limit(150),
    ]);
    for (const item of [customers, properties, invoices, payments, visits, photos, requests]) {
      if (item.error) throw new Error(item.error.message);
    }

    const props = properties.data || [];
    const invoiceById = new Map((invoices.data || []).map((invoice) => [invoice.id, invoice]));
    const propertyOwnerById = new Map(props.map((property) => [property.id, property.customer_id]));
    const records = (customers.data || []).map((customer) => {
      const ownedProperties = props.filter((property) => property.customer_id === customer.id);
      return {
        id: customer.id,
        name: customer.full_name,
        email: customer.email,
        phone: customer.phone,
        notes: customer.notes,
        addresses: ownedProperties.map((p) => [p.address_line1, p.city, p.province, p.postal_code].filter(Boolean).join(", ")),
        payments: (payments.data || []).filter((p) => p.customer_id === customer.id).map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          method: payment.method,
          status: payment.status,
          paidAt: payment.paid_at || payment.created_at,
          invoiceNumber: invoiceById.get(payment.invoice_id || "")?.invoice_number || null,
          description: invoiceById.get(payment.invoice_id || "")?.manual_description || "Property service",
        })),
        invoices: (invoices.data || []).filter((invoice) => invoice.customer_id === customer.id).map((invoice) => ({
          id: invoice.id,
          number: invoice.invoice_number,
          description: invoice.manual_description || "Property service",
          amount: invoice.total,
          status: invoice.status,
          date: invoice.created_at,
        })),
        visits: (visits.data || []).filter((visit) => visit.customer_id === customer.id).map((visit) => ({
          id: visit.id,
          date: visit.scheduled_date,
          status: visit.status,
          finishedAt: visit.finished_at,
          summary: visit.customer_visible_summary || visit.employee_notes || "",
        })),
        photos: (photos.data || []).filter((photo) => propertyOwnerById.get(photo.property_id || "") === customer.id)
          .map((photo) => ({ id: photo.id, type: photo.photo_type, caption: photo.caption, date: photo.created_at, visitId: photo.visit_id })),
      };
    });
    return NextResponse.json({
      customers: records,
      requests: requests.data || [],
      source: "4ever-owner-canonical",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Owner workspace query failed", error);
    return response("Could not load your workspace.", 500);
  }
}
