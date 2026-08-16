import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

const schema = z.object({
  servicePaymentMethod: z.enum(["card", "account_balance"]),
  tipPaymentMethod: z.enum(["card", "account_balance"]),
}).strict();

function preferences(customer: any) {
  return {
    servicePaymentMethod: customer.service_payment_method === "account_balance" ? "account_balance" : "card",
    tipPaymentMethod: customer.tip_payment_method === "account_balance" ? "account_balance" : "card",
  };
}

function statusFor(message: string) {
  return /session expired|sign in/i.test(message) ? 401 : /different|only an active|not linked/i.test(message) ? 403 : 400;
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Payment preferences could not be saved.";
  return NextResponse.json({ error: message }, { status: statusFor(message) });
}

export async function GET(request: NextRequest) {
  try {
    const { customer } = await requireCustomerPortalIdentity(request);
    return NextResponse.json({ preferences: preferences(customer) });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const { service, customer, identity } = await requireCustomerPortalIdentity(request);
    let query = service
      .from("customers")
      .update({
        service_payment_method: body.servicePaymentMethod,
        tip_payment_method: body.tipPaymentMethod,
      })
      .eq("id", identity.customerId)
      .eq("profile_id", identity.profileId);
    if (identity.companyId) {
      query = query.or(`company_id.eq.${identity.companyId},organization_id.eq.${identity.companyId}`);
    }
    const { data, error } = await query
      .select("id,service_payment_method,tip_payment_method")
      .single();
    if (error || !data) throw new Error(error?.message || "Payment preferences could not be saved.");
    return NextResponse.json({ saved: true, preferences: preferences(data || customer) });
  } catch (error) {
    return fail(error);
  }
}
