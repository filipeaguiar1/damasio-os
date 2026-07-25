import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({ customerComment: z.string().trim().max(1500).nullable().optional() }).strict();

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Property updates are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireCustomerProperty(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in before viewing your property.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");
  const email = String(auth.user.email || "").toLowerCase();
  const { data: customer, error: customerError } = await client.from("customers").select("id").or(`profile_id.eq.${auth.user.id},email.ilike.${email.replace(/,/g, "")}`).limit(1).maybeSingle();
  if (customerError || !customer) throw new Error(customerError?.message || "Customer account could not be found.");
  const { data: property, error } = await client.from("properties").select("id,address_line1,city,province,postal_code,lot_size,grass_height,gate,dog,irrigation,access_notes,property_notes,customer_comment").eq("customer_id", customer.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error || !property) throw new Error(error?.message || "Property could not be found.");
  return { client, property };
}

export async function GET(request: NextRequest) {
  try {
    const { property } = await requireCustomerProperty(request);
    return NextResponse.json({ property });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Property could not be loaded." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const { client, property } = await requireCustomerProperty(request);
    const { error } = await client.from("properties").update({ customer_comment: body.customerComment || null, updated_at: new Date().toISOString() }).eq("id", property.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Property comment could not be saved." }, { status: 400 });
  }
}
