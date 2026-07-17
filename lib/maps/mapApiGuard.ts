import { NextRequest, NextResponse } from "next/server";

type WindowState = { count: number; resetAt: number };

const globalState = globalThis as typeof globalThis & { __damasioMapRateLimits?: Map<string, WindowState> };
const limits = globalState.__damasioMapRateLimits || new Map<string, WindowState>();
globalState.__damasioMapRateLimits = limits;

export function enforceMapRateLimit(request: NextRequest, action: string, maximum = 60, windowMs = 60_000) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const client = forwarded || request.headers.get("x-real-ip") || "unknown";
  const key = `${action}:${client}`;
  const now = Date.now();
  const current = limits.get(key);
  if (!current || current.resetAt <= now) {
    limits.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  if (current.count >= maximum) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "Too many map requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } }
    );
  }
  current.count += 1;
  return null;
}

export function isCanadianCoordinate(longitude: number, latitude: number) {
  return longitude >= -141.1 && longitude <= -52.5 && latitude >= 41.5 && latitude <= 83.2;
}
