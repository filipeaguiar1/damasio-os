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
  backyard: z.boolean().optional(),
  gated: z.boolean().optional(),
  annual: z.boolean().optional(),
}).strict();

const publicService = z.enum([
  "Weekly Lawn Care",
  "Biweekly Lawn Care",
  "One-Time Lawn Cut",
  "Spring Cleanup",
  "Fall Cleanup",
  "Snow Removal",
  "Extra Service Request",
]);

const quoteReferral = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).optional().default(""),
  address: z.string().trim().min(5).max(300),
  service: publicService,
  notes: z.string().trim().max(1500).optional().default(""),
  referralCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/).optional().or(z.literal("")),
  estimatedTotal: z.number().nonnegative().nullable().optional(),
  propertyDetails: propertyDetails.optional(),
  website: z.string().max(0).optional(),
}).strict().superRefine((body, ctx) => {
  if (body.service === "Extra Service Request") return;

  const details = body.propertyDetails;
  if (!details) {
    ctx.addIssue({ code: "custom", path: ["propertyDetails"], message: "Property details are required." });
    return;
  }

  const isLawn = body.service === "Weekly Lawn Care" || body.service === "Biweekly Lawn Care" || body.service === "One-Time Lawn Cut";
  const isCleanup = body.service === "Spring Cleanup" || body.service === "Fall Cleanup";
  const expectedCategory = isLawn ? "lawn" : isCleanup ? "cleanup" : "snow";
  if (details.serviceCategory !== expectedCategory) {
    ctx.addIssue({ code: "custom", path: ["propertyDetails", "serviceCategory"], message: "Service details do not match the selected service." });
  }

  const common = ["lawnSize", "difficulty"] as const;
  const specific = isLawn
    ? (["grassHeight", "grassHandling"] as const)
    : isCleanup
      ? (["cleanupLeafLevel", "cleanupDebrisLevel", "cleanupDisposal", "cleanupVisitCount"] as const)
      : (["snowDrivewaySize", "snowArea", "snowSidewalk", "snowSalt", "snowBilling"] as const);

  for (const field of [...common, ...specific]) {
    if (!details[field]) {
      ctx.addIssue({ code: "custom", path: ["propertyDetails", field], message: `${field} is required for this service.` });
    }
  }
});

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 12_000) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ error: "Quote requests are temporarily unavailable." }, { status: 503 });
    }

    const parsed = quoteReferral.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Check the customer, email, address and service information." },
        { status: 400 },
      );
    }

    const body = parsed.data;
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as any;

    let companyId: string | null = null;
    let companyName: string | null = null;

    if (body.referralCode) {
      const { data, error } = await client
        .from("organizations")
        .select("id,name")
        .eq("referral_code", body.referralCode)
        .eq("active", true)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return NextResponse.json({ error: "Company code was not found or is inactive." }, { status: 404 });
      }

      companyId = data.id;
      companyName = data.name;
    }

    const detailsMarker = body.propertyDetails
      ? `PROPERTY_DETAILS:${JSON.stringify(body.propertyDetails)}`
      : null;
    const notes = [
      body.notes,
      typeof body.estimatedTotal === "number"
        ? `Average estimate shown: $${body.estimatedTotal.toFixed(2)}`
        : null,
      body.referralCode ? `Company referral code: ${body.referralCode}` : null,
      detailsMarker,
    ].filter(Boolean).join(" | ") || null;

    // Public traffic may create only a lead. Canonical Customer/Property records
    // are promoted later by the authenticated company approval flow.
    const { error } = await client.from("lead_center").insert({
      assigned_company_id: companyId,
      customer_id: null,
      property_id: null,
      full_name: body.name,
      email: body.email,
      phone: body.phone || null,
      address: body.address,
      service_requested: body.service,
      notes,
      status: companyId ? "offered" : "new",
    });

    if (error) throw error;

    // Never disclose internal Lead/Customer/Property identifiers publicly.
    return NextResponse.json({ saved: true, companyName }, { status: 201 });
  } catch (error) {
    console.error("Quote referral failed", error);
    return NextResponse.json({ error: "Quote referral could not be saved." }, { status: 500 });
  }
}
