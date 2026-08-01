import type { NextRequest } from "next/server";

export function stripeReturnOrigin(request: NextRequest) {
  const requestOrigin = request.nextUrl.origin.replace(/\/$/, "");
  const configured = String(process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

  if (process.env.VERCEL_ENV === "production" && configured) return configured;
  if (requestOrigin) return requestOrigin;
  if (configured) return configured;
  throw new Error("The application return URL is not configured.");
}
