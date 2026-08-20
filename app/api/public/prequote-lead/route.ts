import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const propertyDetails = z.object({
  serviceCategory: z.enum(["lawn", "cleanup", "snow"]).optional(),
  lawnSize: z.enum(["xs", "small", "medium", "large", "legacy", "oversize"]).optional(),
  grassHeight: z.enum(["2in", "3in", "4in", "5in"]).optional(),
  grassHandling: z.enum(["mulched", "bag_green_bin", "bag_leave_property", "removed", "no_preference"]).optional(),
  difficulty: z.enum(["yes", "no"]).optional(),
  cleanupLeafLevel: z.enum(["light", "moderate", "heavy", "not_sure"]).optional(),
  cleanupDebrisLevel: z.enum(["light", "typical", "wooded"]).optional(),
  cleanupDisposal: z.enum(["haul_away", "bag_leave_property", "mulch_wooded_area", "quote_both"]).optional(),
  cleanupVisitCount: z.enum(["one", "two", "unlimited"]).optional(),
  snowDrivewaySize: z.enum(["one_car", "two_car", "three_car", "four_plus", "custom"]).optional(),
  snowArea: z.enum(["under_500", "500_1000", "1000_1500", "1500_plus"]).optional(),
  snowSidewalk: z.enum(["no", "front_walk", "sidewalk_steps", "all_paved"]).optional(),
  snowSalt: z.enum(["no", "yes", "quote_both"]).optional(),
  snowBilling: z.enum(["per_storm", "seasonal", "both"]).optional(),
}).strict();

const prequoteLead = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().min(5).max(40),
  address: z.string().trim().min(5).max(300),
  service: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(1200).optional().default(""),
  referralCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/).optional().or(z.literal("")),
  estimatedTotal: z.number().nonnegative().nullable().optional(),
  propertyDetails: propertyDetails.optional(),
  consentToSave: z.literal(true),
  website: z.string().max(0).optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 12_000) return NextResponse.json({ error: "Request is too large." }, { status: 413 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return NextResponse.json({ error: "Estimate saving is temporarily unavailable." }, { status: 503 });

    const parsed = prequoteLead.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Check your contact and property information." }, { status: 400 });
    const body = parsed.data;
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;

    let companyId: string | null = null;
    if (body.referralCode) {
      const company = await client.from("organizations")
        .select("id")
        .eq("referral_code", body.referralCode)
        .eq("active", true)
        .is("deleted_at", null)
        .maybeSingle();
      if (!company.error && company.data?.id) companyId = company.data.id;
    }

    const resumeToken = crypto.randomUUID();
    const detailsMarker = body.propertyDetails ? `PROPERTY_DETAILS:${JSON.stringify(body.propertyDetails)}` : null;
    const notes = [
      "PREQUOTE_LEAD: estimate viewed; final request not submitted yet",
      `PREQUOTE_TOKEN:${resumeToken}`,
      typeof body.estimatedTotal === "number" ? `Average estimate shown: $${body.estimatedTotal.toFixed(2)}` : null,
      body.referralCode ? `Company referral code entered: ${body.referralCode}` : null,
      body.notes || null,
      detailsMarker,
    ].filter(Boolean).join(" | ");

    const { data, error } = await client.from("lead_center").insert({
      assigned_company_id: companyId,
      full_name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      service_requested: body.service,
      notes,
      status: "new",
    }).select("id").single();
    if (error) throw error;

    return NextResponse.json({ saved: true, leadId: data.id, resumeToken }, { status: 201 });
  } catch (error) {
    console.error("Prequote lead capture failed", error);
    return NextResponse.json({ error: "Estimate details could not be saved." }, { status: 500 });
  }
}
