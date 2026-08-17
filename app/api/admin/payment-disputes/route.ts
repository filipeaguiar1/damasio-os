import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Payment disputes are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function identity(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");
  const db = serviceClient();
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Admin session expired. Sign in again.");
  const { data: profile, error } = await db.from("profiles").select("id,role,active,company_id,organization_id").eq("id", auth.user.id).single();
  if (error || !profile?.active || !["admin", "manager"].includes(profile.role)) throw new Error("Only an active company Admin can review payment disputes.");
  const companyId = String(profile.company_id || profile.organization_id || "");
  if (!companyId) throw new Error("Admin account has no company identity.");
  return { db, companyId };
}

async function enrich(db: any, rows: any[]) {
  const customerIds = [...new Set(rows.map(row => row.customer_id).filter(Boolean))];
  const invoiceIds = [...new Set(rows.map(row => row.invoice_id).filter(Boolean))];
  const paymentIds = [...new Set(rows.map(row => row.payment_id).filter(Boolean))];
  const [{ data: customers }, { data: invoices }, { data: payments }] = await Promise.all([
    customerIds.length ? db.from("customers").select("id,full_name,email").in("id", customerIds) : Promise.resolve({ data: [] }),
    invoiceIds.length ? db.from("invoices").select("id,invoice_number,total").in("id", invoiceIds) : Promise.resolve({ data: [] }),
    paymentIds.length ? db.from("payments").select("id,amount,paid_at").in("id", paymentIds) : Promise.resolve({ data: [] }),
  ]);
  const customerMap = new Map((customers || []).map((row: any) => [String(row.id), row]));
  const invoiceMap = new Map((invoices || []).map((row: any) => [String(row.id), row]));
  const paymentMap = new Map((payments || []).map((row: any) => [String(row.id), row]));
  return rows.map(row => ({ ...row, customer: customerMap.get(String(row.customer_id)) || null, invoice: invoiceMap.get(String(row.invoice_id)) || null, payment: paymentMap.get(String(row.payment_id)) || null }));
}

export async function GET(request: NextRequest) {
  try {
    const { db, companyId } = await identity(request);
    const { data, error } = await db.from("service_requests")
      .select("id,customer_id,property_id,visit_id,invoice_id,payment_id,message,status,created_at,response_due_at,company_response,company_responded_at,customer_decision,customer_decision_at,master_resolution,master_reviewed_at")
      .eq("company_id", companyId).eq("request_type", "payment_dispute").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ disputes: await enrich(db, data || []) });
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
    if (!disputeId || response.length < 5) throw new Error("Write a response of at least 5 characters.");
    const { data: current, error: readError } = await db.from("service_requests").select("id,status").eq("id", disputeId).eq("company_id", companyId).eq("request_type", "payment_dispute").maybeSingle();
    if (readError || !current) throw new Error("Payment dispute was not found for this company.");
    if (["resolved", "cancelled"].includes(String(current.status))) throw new Error("This payment dispute is already closed.");
    const { error } = await db.from("service_requests").update({ status: "company_responded", company_response: response, company_responded_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", disputeId).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: true, status: "company_responded" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Company response could not be saved." }, { status: 400 });
  }
}
