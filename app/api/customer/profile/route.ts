import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).optional().default(""),
}).strict();

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Customer profile updates are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireCustomer(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in before editing your profile.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");
  const { data: customer, error } = await client
    .from("customers")
    .select("id,profile_id,email,full_name,phone,company_id")
    .or(`profile_id.eq.${auth.user.id},email.ilike.${String(auth.user.email || "").replace(/,/g, "")}`)
    .limit(1)
    .maybeSingle();
  if (error || !customer) throw new Error(error?.message || "Customer account could not be found.");
  return { client, customer, user: auth.user };
}

async function responseProfile(client: any, customer: any, user: any) {
  const avatarPath = typeof user.user_metadata?.customer_avatar_path === "string" ? user.user_metadata.customer_avatar_path : "";
  let avatarUrl: string | null = null;
  if (avatarPath) {
    const { data } = await client.storage.from("property-photos").createSignedUrl(avatarPath, 3600);
    avatarUrl = data?.signedUrl || null;
  }
  return {
    id: customer.id,
    fullName: customer.full_name || "",
    phone: customer.phone || "",
    email: customer.email || user.email || "",
    avatarUrl,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { client, customer, user } = await requireCustomer(request);
    return NextResponse.json({ profile: await responseProfile(client, customer, user) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Customer profile could not be loaded." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const { client, customer, user } = await requireCustomer(request);
    const { data, error } = await client
      .from("customers")
      .update({ full_name: body.fullName, phone: body.phone || null, updated_at: new Date().toISOString() })
      .eq("id", customer.id)
      .select("id,full_name,phone,email,company_id")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: true, profile: await responseProfile(client, data, user) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Customer profile could not be saved." }, { status: 400 });
  }
}
