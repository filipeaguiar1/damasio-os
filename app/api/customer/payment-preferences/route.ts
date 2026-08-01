import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const method = z.enum(["card", "account_balance"]);
const schema = z.object({
  servicePaymentMethod: method,
  tipPaymentMethod: method,
}).strict();

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Payment preferences are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireCustomer(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in before changing payment preferences.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");

  let customer = null;
  const byProfile = await client.from("customers").select("id,profile_id,email,service_payment_method,tip_payment_method,archived_at").eq("profile_id", auth.user.id).is("archived_at", null).limit(1).maybeSingle();
  if (!byProfile.error) customer = byProfile.data;
  if (!customer && auth.user.user_metadata?.customer_id) {
    const byMetadata = await client.from("customers").select("id,profile_id,email,service_payment_method,tip_payment_method,archived_at").eq("id", auth.user.user_metadata.customer_id).is("archived_at", null).maybeSingle();
    if (!byMetadata.error) customer = byMetadata.data;
  }
  if (!customer && auth.user.email) {
    const byEmail = await client.from("customers").select("id,profile_id,email,service_payment_method,tip_payment_method,archived_at").ilike("email", auth.user.email.trim()).is("archived_at", null).limit(1).maybeSingle();
    if (!byEmail.error) customer = byEmail.data;
  }
  if (!customer) throw new Error("Customer account is not linked yet.");
  return { client, customer };
}

function response(customer: any) {
  return {
    servicePaymentMethod: customer.service_payment_method === "account_balance" ? "account_balance" : "card",
    tipPaymentMethod: customer.tip_payment_method === "account_balance" ? "account_balance" : "card",
  };
}

export async function GET(request: NextRequest) {
  try {
    const { customer } = await requireCustomer(request);
    return NextResponse.json(response(customer));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment preferences could not be loaded." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const { client, customer } = await requireCustomer(request);
    const { data, error } = await client.from("customers").update({
      service_payment_method: body.servicePaymentMethod,
      tip_payment_method: body.tipPaymentMethod,
      updated_at: new Date().toISOString(),
    }).eq("id", customer.id).select("service_payment_method,tip_payment_method").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: true, ...response(data) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment preferences could not be saved." }, { status: 400 });
  }
}
