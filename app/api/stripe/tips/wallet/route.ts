import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return failure("Wallet tips are not configured yet.", 503);

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return failure("Sign in before paying a tip.", 401);

    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return failure("Your session expired. Sign in again.", 401);

    let customer = null;
    const byProfile = await db.from("customers").select("id,company_id,organization_id,email,archived_at").eq("profile_id", auth.user.id).is("archived_at", null).maybeSingle();
    if (!byProfile.error) customer = byProfile.data;

    if (!customer && auth.user.user_metadata?.customer_id) {
      const byMetadata = await db.from("customers").select("id,company_id,organization_id,email,archived_at").eq("id", auth.user.user_metadata.customer_id).is("archived_at", null).maybeSingle();
      if (!byMetadata.error) customer = byMetadata.data;
    }

    if (!customer && auth.user.email) {
      const byEmail = await db.from("customers").select("id,company_id,organization_id,email,archived_at").ilike("email", auth.user.email.trim()).is("archived_at", null).limit(1).maybeSingle();
      if (!byEmail.error) customer = byEmail.data;
    }

    if (!customer) return failure("Customer account is not linked yet.", 403);

    const body = (await request.json()) as { amount?: number; note?: string };
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 500) return failure("Choose a tip between $1 and $500.", 400);

    const { data, error } = await db.rpc("pay_customer_tip_from_wallet", {
      p_customer_id: customer.id,
      p_company_id: customer.company_id || customer.organization_id || null,
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
    return failure(error instanceof Error ? error.message : "Could not pay the tip from wallet credits.", 500);
  }
}
