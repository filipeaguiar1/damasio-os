import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Customer offers are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as a company Admin.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");
  const { data: profile, error } = await client.from("profiles").select("role,active,company_id,organization_id").eq("id", auth.user.id).single();
  if (error || !profile?.active || profile.role !== "admin") throw new Error("Only a company Admin can view offers.");
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Admin profile is not linked to a company.");
  return { client, companyId: String(companyId) };
}

export async function GET(request: NextRequest) {
  try {
    const { client, companyId } = await requireAdmin(request);
    const { data: customers, error } = await client
      .from("customers")
      .select("id,full_name,service_company_id,offer_status,offered_service_price,company_service_payout,offer_sent_at,last_transfer_reason")
      .eq("service_company_id", companyId)
      .eq("offer_status", "offered")
      .is("archived_at", null)
      .order("offer_sent_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = (customers || []).map((item: any) => item.id);
    const propertyMap = new Map<string, any>();
    if (ids.length) {
      const { data: properties, error: propertyError } = await client
        .from("properties")
        .select("id,customer_id,address_line1,city,province,postal_code,official_photo_url,company_id,organization_id")
        .in("customer_id", ids)
        .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
        .order("created_at");
      if (propertyError) throw new Error(propertyError.message);
      for (const property of properties || []) {
        if (!propertyMap.has(property.customer_id)) propertyMap.set(property.customer_id, property);
      }
    }
    return NextResponse.json({ offers: (customers || []).map((customer: any) => ({
      id: customer.id,
      fullName: customer.full_name,
      payout: Number(customer.company_service_payout ?? customer.offered_service_price ?? 0),
      sentAt: customer.offer_sent_at,
      note: customer.last_transfer_reason,
      property: propertyMap.get(customer.id) || null,
    })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Offers could not be loaded." }, { status: 400 });
  }
}
