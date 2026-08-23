import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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
  notes: z.string().trim().max(1500).optional().default(""),
  referralCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/).optional().or(z.literal("")),
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

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allow(ip)) return NextResponse.json({ ok: true, rateLimited: true });

  try {
    const parsed = preQuoteAlert.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid pre-quote alert." }, { status: 400 });
    const body = parsed.data;
    if (body.website) return NextResponse.json({ ok: true });

    const client = serverClient();
    let preQuoteId: string | null = null;
    let companyId: string | null = null;
    let companyName: string | null = null;

    if (client) {
      if (body.referralCode) {
        const company = await client.from("organizations")
          .select("id,name")
          .eq("referral_code", body.referralCode)
          .eq("active", true)
          .is("deleted_at", null)
          .maybeSingle();
        if (!company.error && company.data) {
          companyId = String(company.data.id);
          companyName = String(company.data.name || "");
        }
      }

      const notes = [
        "QUOTE_STAGE:prequote",
        body.notes || null,
        typeof body.estimatedTotal === "number" ? `Average estimate shown: $${body.estimatedTotal.toFixed(2)}` : null,
        body.referralCode ? `Company referral code: ${body.referralCode}` : null,
      ].filter(Boolean).join(" | ");

      const existing = await client.from("lead_center")
        .select("id")
        .eq("status", "new")
        .ilike("email", body.email)
        .eq("address", body.address)
        .eq("service_requested", body.service)
        .like("notes", "%QUOTE_STAGE:prequote%")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!existing.error && existing.data?.id) {
        preQuoteId = String(existing.data.id);
        const updated = await client.from("lead_center").update({
          assigned_company_id: companyId,
          full_name: body.name,
          email: body.email,
          phone: body.phone || null,
          address: body.address,
          service_requested: body.service,
          notes,
          updated_at: new Date().toISOString(),
        }).eq("id", preQuoteId);
        if (updated.error) console.error("Pre-quote update failed", updated.error);
      } else {
        const created = await client.from("lead_center").insert({
          assigned_company_id: companyId,
          full_name: body.name,
          email: body.email,
          phone: body.phone || null,
          address: body.address,
          service_requested: body.service,
          notes,
          status: "new",
        }).select("id").single();
        if (created.error) {
          console.error("Pre-quote persistence failed", created.error);
        } else {
          preQuoteId = String(created.data.id);
        }
      }
    } else {
      console.error("Pre-quote persistence skipped: Supabase server credentials are not configured");
    }

    const emailDelivered = await sendQuoteAlert({
      stage: "prequote",
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      service: body.service,
      estimatedTotal: body.estimatedTotal ?? null,
      leadId: preQuoteId,
      companyName,
    });

    return NextResponse.json({ ok: true, preQuoteId, emailDelivered });
  } catch (error) {
    console.error("Pre-quote alert route failed", error);
    return NextResponse.json({ ok: true, preQuoteId: null, emailDelivered: false });
  }
}
