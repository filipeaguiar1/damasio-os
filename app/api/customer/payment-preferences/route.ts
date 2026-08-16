import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

const method = z.enum(["card", "account_balance"]);
const schema = z.object({
  servicePaymentMethod: method,
  tipPaymentMethod: method,
}).strict();

function response(customer: any) {
  return {
    servicePaymentMethod: customer.service_payment_method === "account_balance" ? "account_balance" : "card",
    tipPaymentMethod: customer.tip_payment_method === "account_balance" ? "account_balance" : "card",
  };
}

export async function GET(request: NextRequest) {
  try {
    const { customer } = await requireCustomerPortalIdentity(request);
    return NextResponse.json(response(customer));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment preferences could not be loaded.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const { service, customer, identity } = await requireCustomerPortalIdentity(request);
    let query = service.from("customers").update({
      service_payment_method: body.servicePaymentMethod,
      tip_payment_method: body.tipPaymentMethod,
    }).eq("id", identity.customerId).eq("profile_id", identity.profileId);
    if (identity.companyId) {
      query = query.or(`company_id.eq.${identity.companyId},organization_id.eq.${identity.companyId}`);
    }
    const { data, error } = await query.select("service_payment_method,tip_payment_method").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: true, ...response(data || customer) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment preferences could not be saved.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
