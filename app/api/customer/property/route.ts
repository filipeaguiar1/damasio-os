import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  lotSize: z.string().trim().max(40).nullable().optional(),
  grassHeight: z.string().trim().max(40).nullable().optional(),
  gate: z.boolean().optional(),
  dog: z.boolean().optional(),
  irrigation: z.boolean().optional(),
  accessNotes: z.string().trim().max(1000).nullable().optional(),
  propertyNotes: z.string().trim().max(1500).nullable().optional(),
}).strict();

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Property updates are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireCustomerProperty(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in before editing your property.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");
  const email = String(auth.user.email || "").toLowerCase();
  const { data: customer, error: customerError } = await client.from("customers").select("id").or(`profile_id.eq.${auth.user.id},email.ilike.${email.replace(/,/g, "")}`).limit(1).maybeSingle();
  if (customerError || !customer) throw new Error(customerError?.message || "Customer account could not be found.");
  const { data: property, error } = await client.from("properties").select("id").eq("customer_id", customer.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error || !property) throw new Error(error?.message || "Property could not be found.");
  return { client, propertyId: property.id };
}

export async function PATCH(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const { client, propertyId } = await requireCustomerProperty(request);
    const patch = {
      lot_size: body.lotSize ?? null,
      grass_height: body.grassHeight ?? null,
      gate: body.gate ?? false,
      dog: body.dog ?? false,
      irrigation: body.irrigation ?? false,
      access_notes: body.accessNotes ?? null,
      property_notes: body.propertyNotes ?? null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await client.from("properties").update(patch).eq("id", propertyId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Property could not be saved." }, { status: 400 });
  }
}
