import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().min(7).max(40),
  address: z.string().trim().min(5).max(250),
  city: z.string().trim().min(2).max(100),
  plan: z.enum(["single", "monthly", "season"]),
  notes: z.string().trim().max(1200).optional().default(""),
  website: z.string().max(0).optional().default(""),
}).strict();

const planNames = {
  single: "Single snow removal visit",
  monthly: "Monthly snow coverage",
  season: "Full winter season snow coverage",
};
const rate = new Map<string, { count: number; reset: number }>();

function throttle(key: string) {
  const now = Date.now();
  if (rate.size > 3000) for (const [k, entry] of rate) if (entry.reset < now) rate.delete(k);
  const entry = rate.get(key);
  if (!entry || entry.reset <= now) { rate.set(key, { count: 1, reset: now + 600000 }); return false; }
  entry.count++;
  return entry.count > 5;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (throttle(ip)) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please review the information provided." }, { status: 400 });
  const body = parsed.data;
  if (body.website) return NextResponse.json({ ok: true });

  const companyId = process.env.FOREVER_COMPANY_ID;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!companyId || !url || !key) return NextResponse.json({ error: "Online requests are temporarily unavailable. Please contact us directly." }, { status: 503 });
  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: company, error: companyError } = await db.from("organizations")
      .select("id").eq("id", companyId).eq("active", true).is("deleted_at", null).maybeSingle();
    if (companyError || !company) return NextResponse.json({ error: "Online service requests are not set up yet." }, { status: 503 });

    const record = await db.from("lead_center").insert({
      assigned_company_id: company.id,
      full_name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address + ", " + body.city + ", Ontario",
      service_requested: planNames[body.plan],
      notes: ["SOURCE:forever-private", "PLAN:" + body.plan, body.notes].filter(Boolean).join(" | "),
      status: "new",
    }).select("id").single();
    if (record.error) throw record.error;
    return NextResponse.json({ ok: true, requestId: record.data.id, message: "Request received. A final quote and availability will be confirmed before payment." }, { status: 201 });
  } catch (error) {
    console.error("Private snow request failed", error);
    return NextResponse.json({ error: "We could not save your request. Please try again." }, { status: 500 });
  }
}
