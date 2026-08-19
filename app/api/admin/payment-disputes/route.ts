import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function configured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Payment disputes are not configured.");
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

async function identity(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");
  const db = serviceClient();
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Admin session expired. Sign in again.");
  const { data: profile, error } = await db.from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.user.id)
    .single();
  if (error || !profile?.active || !["admin", "manager"].includes(profile.role)) {
    throw new Error("Only an active company Admin can review payment disputes.");
  }
  const companyId = String(profile.company_id || profile.organization_id || "");
  if (!companyId) throw new Error("Admin account has no company identity.");
  if (profile.role === "manager") {
    const permission = await userClient(token).rpc("require_company_module_permission", {
      p_module: "finance",
      p_required: "manage",
    });
    if (permission.error) throw new Error(permission.error.message);
  }
  return { db, companyId };
}

async function enrich(db: any, companyId: string, rows: any[]) {
  const customerIds = [...new Set(rows.map(row => row.customer_id).filter(Boolean))];
  const invoiceIds = [...new Set(rows.map(row => row.invoice_id).filter(Boolean))];
  const paymentIds = [...new Set(rows.map(row => row.payment_id).filter(Boolean))];

  const customerQuery = customerIds.length
    ? db.from("customers").select("id,full_name,email,company_id,organization_id").in("id", customerIds)
      .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
    : Promise.resolve({ data: [] });
  const invoiceQuery = invoiceIds.length
    ? db.from("invoices").select("id,invoice_number,total,organization_id").in("id", invoiceIds).eq("organization_id", companyId)
    : Promise.resolve({ data: [] });
  const paymentQuery = paymentIds.length
    ? db.from("payments").select("id,amount,paid_at,company_id,organization_id").in("id", paymentIds)
      .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
    : Promise.resolve({ data: [] });

  const [{ data: customers }, { data: invoices }, { data: payments }] = await Promise.all([
    customerQuery,
    invoiceQuery,
    paymentQuery,
  ]);
  const customerMap = new Map((customers || []).map((row: any) => [String(row.id), row]));
  const invoiceMap = new Map((invoices || []).map((row: any) => [String(row.id), row]));
  const paymentMap = new Map((payments || []).map((row: any) => [String(row.id), row]));
  return rows.map(row => ({
    ...row,
    customer: customerMap.get(String(row.customer_id)) || null,
    invoice: invoiceMap.get(String(row.invoice_id)) || null,
    payment: paymentMap.get(String(row.payment_id)) || null,
  }));
}

export async function GET(request: NextRequest) {
  try {
    const { db, companyId } = await identity(request);
    const { data, error } = await db.from("service_requests")
      .select("id,customer_id,property_id,visit_id,invoice_id,payment_id,message,status,created_at,response_due_at,company_response,company_responded_at,customer_decision,customer_decision_at,master_resolution,master_reviewed_at")
      .eq("company_id", companyId)
      .eq("request_type", "payment_dispute")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ disputes: await enrich(db, companyId, data || []) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment disputes could not be loaded." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, companyId } = await identity(request);
    const body = await request.json() as { disputeId?: string; response?: string };
    const disputeId = String(body.disputeId || "");
    const response = String(body.response || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(disputeId) || response.length < 5 || response.length > 4000) {
      throw new Error("Choose a valid dispute and write a response between 5 and 4000 characters.");
    }
    const { data: current, error: readError } = await db.from("service_requests")
      .select("id,status")
      .eq("id", disputeId)
      .eq("company_id", companyId)
      .eq("request_type", "payment_dispute")
      .maybeSingle();
    if (readError || !current) throw new Error("Payment dispute was not found for this company.");
    if (["resolved", "cancelled"].includes(String(current.status))) throw new Error("This payment dispute is already closed.");
    const { error } = await db.from("service_requests")
      .update({
        status: "company_responded",
        company_response: response,
        company_responded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", disputeId)
      .eq("company_id", companyId)
      .eq("request_type", "payment_dispute");
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: true, status: "company_responded" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Company response could not be saved." }, { status: 400 });
  }
}
