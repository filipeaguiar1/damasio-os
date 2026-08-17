import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Master payment disputes are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const db = serviceClient();
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Master session expired. Sign in again.");
  const { data: profile, error } = await db.from("profiles").select("id,role,active").eq("id", auth.user.id).single();
  if (error || !profile?.active || profile.role !== "master") throw new Error("Master access is required.");
  return db;
}

export async function GET(request: NextRequest) {
  try {
    const db = await requireMaster(request);
    const { data: rows, error } = await db.from("service_requests")
      .select("id,company_id,customer_id,visit_id,invoice_id,payment_id,message,status,created_at,response_due_at,company_response,company_responded_at,customer_decision,customer_decision_at,master_resolution,master_reviewed_at")
      .eq("request_type", "payment_dispute").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const companyIds = [...new Set((rows || []).map((row: any) => row.company_id).filter(Boolean))];
    const customerIds = [...new Set((rows || []).map((row: any) => row.customer_id).filter(Boolean))];
    const invoiceIds = [...new Set((rows || []).map((row: any) => row.invoice_id).filter(Boolean))];
    const [{ data: companies }, { data: customers }, { data: invoices }] = await Promise.all([
      companyIds.length ? db.from("organizations").select("id,name,contact_email").in("id", companyIds) : Promise.resolve({ data: [] }),
      customerIds.length ? db.from("customers").select("id,full_name,email").in("id", customerIds) : Promise.resolve({ data: [] }),
      invoiceIds.length ? db.from("invoices").select("id,invoice_number,total").in("id", invoiceIds) : Promise.resolve({ data: [] }),
    ]);
    const cm = new Map((companies || []).map((x: any) => [String(x.id), x]));
    const cu = new Map((customers || []).map((x: any) => [String(x.id), x]));
    const im = new Map((invoices || []).map((x: any) => [String(x.id), x]));
    const now = Date.now();
    const disputes = (rows || []).map((row: any) => ({
      ...row,
      company: cm.get(String(row.company_id)) || null,
      customer: cu.get(String(row.customer_id)) || null,
      invoice: im.get(String(row.invoice_id)) || null,
      overdue: row.status === "pending" && row.response_due_at && new Date(row.response_due_at).getTime() < now,
    }));
    return NextResponse.json({ disputes });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Master disputes could not be loaded." }, { status: 400 });
  }
}
