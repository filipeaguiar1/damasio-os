import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const quoteReferral = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).optional().default(""),
  address: z.string().trim().min(5).max(300),
  service: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(1500).optional().default(""),
  referralCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/).optional().or(z.literal("")),
  website: z.string().max(0).optional() // honeypot: real customers never fill this field
}).strict();

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 12_000) return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return NextResponse.json({ error: "Quote requests are temporarily unavailable." }, { status: 503 });

    const parsed = quoteReferral.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Check the customer, email, address and service information." }, { status: 400 });
    const body = parsed.data;
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    let companyId: string | null = null;
    let companyName: string | null = null;
    if (body.referralCode) {
      const { data, error } = await client.from("organizations").select("id,name").eq("referral_code", body.referralCode).eq("active", true).is("deleted_at", null).maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Company code was not found or is inactive." }, { status: 404 });
      companyId = data.id;
      companyName = data.name;
    }
    const { data, error } = await client.from("lead_center").insert({
      assigned_company_id: companyId,
      full_name: body.name,
      email: body.email,
      phone: body.phone || null,
      address: body.address,
      service_requested: body.service,
      notes: [body.notes, body.referralCode ? `Company referral code: ${body.referralCode}` : null].filter(Boolean).join(" | ") || null,
      status: companyId ? "offered" : "new"
    }).select("id").single();
    if (error) throw error;
    return NextResponse.json({ saved: true, leadId: data.id, companyName }, { status: 201 });
  } catch (error) {
    console.error("Quote referral failed", error);
    return NextResponse.json({ error: "Quote referral could not be saved." }, { status: 500 });
  }
}
