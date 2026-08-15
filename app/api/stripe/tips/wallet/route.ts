import { NextRequest, NextResponse } from "next/server";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const { service: db, identity } = await requireCustomerPortalIdentity(request);
    const body = (await request.json()) as { amount?: number; note?: string };
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 500) return failure("Choose a tip between $1 and $500.", 400);

    const { data, error } = await db.rpc("pay_customer_tip_from_wallet", {
      p_customer_id: identity.customerId,
      p_company_id: identity.companyId,
      p_amount_cents: Math.round(amount * 100),
      p_note: String(body.note || "").slice(0, 200) || null,
    });

    if (error) {
      const text = String(error.message || "");
      if (text.toLowerCase().includes("insufficient wallet balance")) return failure("Your wallet does not have enough credits for this tip.", 409);
      if (text.toLowerCase().includes("wallet not found")) return failure("Add wallet credits before paying a tip from balance.", 409);
      throw new Error(text || "Wallet tip failed.");
    }

    const result = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      paid: true,
      amount,
      balanceCredits: Number(result?.balance_cents || 0) / 100,
      message: "Tip paid successfully from wallet credits.",
    });
  } catch (error) {
    console.error("Wallet tip payment failed", error);
    const message = error instanceof Error ? error.message : "Could not pay the tip from wallet credits.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active|not linked/i.test(message) ? 403 : 500;
    return failure(message, status);
  }
}
