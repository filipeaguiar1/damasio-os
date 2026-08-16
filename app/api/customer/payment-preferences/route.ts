import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  servicePaymentMethod: z.enum(["card", "account_balance"]),
  tipPaymentMethod: z.enum(["card", "account_balance"]),
}).strict();

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Customer billing is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireCustomer(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in before editing payment preferences.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");
  const email = String(auth.user.email || "").replace(/,/g, "");
  const { data: customer, error } = await client
    .from("customers")
    .select("id,service_payment_method,tip_payment_method")
    .or(`profile_id.eq.${auth.user.id},email.ilike.${email}`)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (error || !customer) throw new Error(error?.message || "Customer account could not be found.");
  return { client, customer };
}

function preferences(customer: any) {
  return {
    servicePaymentMethod: customer.service_payment_method === "account_balance" ? "account_balance" : "card",
    tipPaymentMethod: customer.tip_payment_method === "account_balance" ? "account_balance" : "card",
  };
}

function fail(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Payment preferences could not be saved." }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { customer } = await requireCustomer(request);
    return NextResponse.json({ preferences: preferences(customer) });
  } catch (error) {
    return fail(error, 503);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const { client, customer } = await requireCustomer(request);
    const { data, error } = await client
      .from("customers")
      .update({
        service_payment_method: body.servicePaymentMethod,
        tip_payment_method: body.tipPaymentMethod,
        updated_at: new Date().toISOString(),
      })
      .eq("id", customer.id)
      .select("id,service_payment_method,tip_payment_method")
      .single();
    if (error || !data) throw new Error(error?.message || "Payment preferences could not be saved.");
    return NextResponse.json({ saved: true, preferences: preferences(data) });
  } catch (error) {
    return fail(error, 503);
  }
}
