import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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

  return NextResponse.json({
    configured: Boolean(
      stripeKey
      && process.env.NEXT_PUBLIC_SUPABASE_URL
      && process.env.SUPABASE_SERVICE_ROLE_KEY
      && process.env.NEXT_PUBLIC_SITE_URL,
    ),
    mode,
    testPaymentsAllowed: mode === "test" && process.env.VERCEL_ENV !== "production",
    webhookConfigured,
    environment: process.env.VERCEL_ENV || "local",
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
  }, {
    headers: { "cache-control": "no-store" },
  });
}
