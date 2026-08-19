import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

const schema = z.object({
  servicePaymentMethod: z.enum(["card", "account_balance"]),
  tipPaymentMethod: z.enum(["card", "account_balance"]),
}).strict();

async function requireCustomer(request: NextRequest) {
  const { service, customer, identity } = await requireCustomerPortalIdentity(request);
  if (!customer) throw new Error("Customer account could not be found.");
  return { client: service, customer, identity };
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
    const { client, customer, identity } = await requireCustomer(request);
    let update = client
      .from("customers")
      .update({
        service_payment_method: body.servicePaymentMethod,
        tip_payment_method: body.tipPaymentMethod,
        updated_at: new Date().toISOString(),
      })
      .eq("id", identity.customerId)
      .eq("profile_id", identity.profileId)
      .is("archived_at", null);
    if (identity.companyId) {
      update = update.or(`company_id.eq.${identity.companyId},organization_id.eq.${identity.companyId}`);
    }
    const { data, error } = await update
      .select("id,service_payment_method,tip_payment_method")
      .single();
    if (error || !data) throw new Error(error?.message || "Payment preferences could not be saved.");
    return NextResponse.json({ saved: true, preferences: preferences(data) });
  } catch (error) {
    return fail(error, 503);
  }
}
