import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Monthly billing CRON_SECRET is not configured." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Monthly billing database access is not configured." }, { status: 503 });
  }

  try {
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await db.rpc("materialize_due_monthly_billing_cycles", {
      p_reference_date: today,
      p_limit: 1000,
    });
    if (error) throw new Error(error.message);

    const [{ count: openInvoices, error: invoiceError }, { count: failedCycles, error: cycleError }] = await Promise.all([
      db.from("invoices").select("id", { count: "exact", head: true }).in("status", ["waiting_payment", "overdue"]),
      db.from("billing_cycles").select("id", { count: "exact", head: true }).eq("state", "payment_failed"),
    ]);
    if (invoiceError) throw new Error(invoiceError.message);
    if (cycleError) throw new Error(cycleError.message);

    return NextResponse.json({
      ok: true,
      billingDate: today,
      materialized: data || {},
      openInvoices: openInvoices || 0,
      failedCycles: failedCycles || 0,
    });
  } catch (error) {
    console.error("Monthly billing cron failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Monthly billing cron failed." }, { status: 500 });
  }
}
