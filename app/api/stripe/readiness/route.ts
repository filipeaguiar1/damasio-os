import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function stripeMode(key?: string) {
  if (!key) return "missing";
  if (key.startsWith("sk_test_")) return "test";
  if (key.startsWith("sk_live_")) return "live";
  return "unknown";
}

export async function GET() {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const mode = stripeMode(stripeKey);
  const webhookConfigured = Boolean(
    process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  );
  const supabaseManagementConfigured = Boolean(
    process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_MANAGEMENT_ACCESS_TOKEN,
  );
  const directDatabaseConfigured = Boolean(
    process.env.DATABASE_URL
      || process.env.DIRECT_URL
      || process.env.POSTGRES_URL
      || process.env.POSTGRES_URL_NON_POOLING
      || process.env.SUPABASE_DB_URL,
  );

  return NextResponse.json({
    configured: Boolean(
      stripeKey
      && process.env.NEXT_PUBLIC_SUPABASE_URL
      && process.env.SUPABASE_SERVICE_ROLE_KEY
      && process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    ),
    mode,
    testPaymentsAllowed: mode === "test" && process.env.VERCEL_ENV === "preview",
    webhookConfigured,
    supabaseManagementConfigured,
    directDatabaseConfigured,
    environment: process.env.VERCEL_ENV || "local",
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
  }, {
    headers: { "cache-control": "no-store" },
  });
}
