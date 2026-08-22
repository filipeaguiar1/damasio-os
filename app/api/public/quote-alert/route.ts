import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendQuoteAlert } from "@/lib/server/quoteEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 8;
const buckets = new Map<string, { count: number; reset: number }>();

const preQuoteAlert = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).optional().default(""),
  address: z.string().trim().min(5).max(300),
  service: z.string().trim().min(2).max(120),
  estimatedTotal: z.number().nonnegative().nullable().optional(),
  website: z.string().max(0).optional(),
}).strict();

function allow(ip: string) {
  const now = Date.now();
  const current = buckets.get(ip);
  if (!current || current.reset < now) {
    buckets.set(ip, { count: 1, reset: now + WINDOW_MS });
    return true;
  }
  if (current.count >= MAX_REQUESTS) return false;
  current.count += 1;
  return true;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allow(ip)) return NextResponse.json({ ok: true });

  try {
    const parsed = preQuoteAlert.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid pre-quote alert." }, { status: 400 });
    const body = parsed.data;
    if (body.website) return NextResponse.json({ ok: true });

    await sendQuoteAlert({
      stage: "prequote",
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      service: body.service,
      estimatedTotal: body.estimatedTotal ?? null,
    });

    // Alert delivery is intentionally best-effort; it must never block the customer quote flow.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Pre-quote alert route failed", error);
    return NextResponse.json({ ok: true });
  }
}
