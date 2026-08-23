import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { sendQuoteAlert } from "@/lib/server/quoteEmail";

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

const quoteReferral = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).optional().default(""),
  address: z.string().trim().min(5).max(300),
  service: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(1500).optional().default(""),
  referralCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/).optional().or(z.literal("")),
  preQuoteId: z.string().uuid().optional().or(z.literal("")),
  estimatedTotal: z.number().nonnegative().nullable().optional(),
  propertyDetails: propertyDetails.optional(),
  website: z.string().max(0).optional()
}).strict();

const detailLabels: Record<string, string> = {
  lawn: "Lawn",
  cleanup: "Seasonal cleanup",
  snow: "Snow removal",
  xs: "XS",
  small: "Small",
  medium: "Medium",
  large: "Large",
  legacy: "Large",
  oversize: "Oversize",
  "2in": "2 inches",
  "3in": "3 inches",
  "4in": "4 inches",
  "5in": "5 inches",
  mulched: "Mulched",
  bag_green_bin: "Bag to green bin",
  bag_leave_property: "Bag and leave on property",
  removed: "Removed",
  no_preference: "No preference",
  yes: "Yes",
  no: "No",
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
  not_sure: "Not sure",
  typical: "Typical branches/debris",
  wooded: "Large / wooded property",
  haul_away: "Haul away debris",
  mulch_wooded_area: "Mulch or blow into wooded area",
  quote_both: "Quote both",
  one: "One visit",
  two: "Two visits",
  unlimited: "Unlimited visits",
  one_car: "1-car driveway",
  two_car: "2-car driveway",
  three_car: "3-car driveway",
  four_plus: "4+ car driveway",
  custom: "Custom / long driveway",
  under_500: "Under 500 sq ft",
  "500_1000": "500-1,000 sq ft",
  "1000_1500": "1,000-1,500 sq ft",
  "1500_plus": "1,500+ sq ft",
  front_walk: "Front walkway",
  sidewalk_steps: "Sidewalk and steps",
  all_paved: "All paved surfaces",
  per_storm: "Per storm",
  seasonal: "Seasonal",
  both: "Quote both",
};

function detailLabel(value?: string) {
  return value ? detailLabels[value] || value.replaceAll("_", " ") : "";
}

function propertyValues(details?: z.infer<typeof propertyDetails>) {
  if (!details) return {};
  const values: Record<string, string> = {};
  if (details.lawnSize) values.lot_size = details.lawnSize;
  if (details.grassHeight) values.grass_height = details.grassHeight;

  const propertyNotes = [
    details.serviceCategory ? `Service category: ${detailLabel(details.serviceCategory)}` : null,
    details.lawnSize ? `Property size: ${detailLabel(details.lawnSize)}` : null,
    details.grassHeight ? `Grass height: ${detailLabel(details.grassHeight)}` : null,
    details.grassHandling ? `Grass handling: ${detailLabel(details.grassHandling)}` : null,
    details.cleanupLeafLevel ? `Leaf amount: ${detailLabel(details.cleanupLeafLevel)}` : null,
    details.cleanupDebrisLevel ? `Stick/debris pickup: ${detailLabel(details.cleanupDebrisLevel)}` : null,
    details.cleanupDisposal ? `Cleanup disposal: ${detailLabel(details.cleanupDisposal)}` : null,
    details.cleanupVisitCount ? `Cleanup visits: ${detailLabel(details.cleanupVisitCount)}` : null,
    details.snowDrivewaySize ? `Driveway size: ${detailLabel(details.snowDrivewaySize)}` : null,
    details.snowArea ? `Snow clearing area: ${detailLabel(details.snowArea)}` : null,
    details.snowSidewalk ? `Sidewalk/walkway clearing: ${detailLabel(details.snowSidewalk)}` : null,
    details.snowSalt ? `Salt/de-icing: ${detailLabel(details.snowSalt)}` : null,
    details.snowBilling ? `Snow billing preference: ${detailLabel(details.snowBilling)}` : null,
    details.difficulty ? `Terrain/access difficulty: ${detailLabel(details.difficulty)}` : null,
  ].filter(Boolean).join(" | ");
  if (propertyNotes) values.property_notes = propertyNotes;
  return values;
}

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
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
    let companyId: string | null = null;
    let companyName: string | null = null;
    if (body.referralCode) {
      const { data, error } = await client.from("organizations").select("id,name").eq("referral_code", body.referralCode).eq("active", true).is("deleted_at", null).maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Company code was not found or is inactive." }, { status: 404 });
      companyId = data.id;
      companyName = data.name;
    }

    const detailsMarker = body.propertyDetails ? `PROPERTY_DETAILS:${JSON.stringify(body.propertyDetails)}` : null;
    const notes = [
      "QUOTE_STAGE:submitted",
      body.notes,
      typeof body.estimatedTotal === "number" ? `Average estimate shown: $${body.estimatedTotal.toFixed(2)}` : null,
      body.referralCode ? `Company referral code: ${body.referralCode}` : null,
      detailsMarker,
    ].filter(Boolean).join(" | ") || null;

    let customerId: string | null = null;
    let propertyId: string | null = null;

    if (companyId) {
      const existingCustomer = await client.from("customers").select("id").eq("company_id", companyId).ilike("email", body.email).maybeSingle();
      if (existingCustomer.error) throw existingCustomer.error;

      if (existingCustomer.data?.id) {
        customerId = existingCustomer.data.id;
        const updated = await client.from("customers").update({ full_name: body.name, phone: body.phone || null, notes: body.notes || null }).eq("id", customerId);
        if (updated.error) throw updated.error;
      } else {
        const created = await client.from("customers").insert({
          organization_id: companyId,
          company_id: companyId,
          full_name: body.name,
          email: body.email,
          phone: body.phone || null,
          notes: body.notes || null,
        }).select("id").single();
        if (created.error) throw created.error;
        customerId = created.data.id;
      }

      const existingProperty = await client.from("properties").select("id").eq("company_id", companyId).eq("customer_id", customerId).order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (existingProperty.error) throw existingProperty.error;

      const canonicalProperty = {
        organization_id: companyId,
        company_id: companyId,
        customer_id: customerId,
        address_line1: body.address,
        city: "Hamilton",
        province: "ON",
        country: "Canada",
        ...propertyValues(body.propertyDetails),
      };

      if (existingProperty.data?.id) {
        propertyId = existingProperty.data.id;
        const updated = await client.from("properties").update(canonicalProperty).eq("id", propertyId);
        if (updated.error) throw updated.error;
      } else {
        const created = await client.from("properties").insert(canonicalProperty).select("id").single();
        if (created.error) throw created.error;
        propertyId = created.data.id;
      }
    }

    const { data, error } = await client.from("lead_center").insert({
      assigned_company_id: companyId,
      customer_id: customerId,
      property_id: propertyId,
      full_name: body.name,
      email: body.email,
      phone: body.phone || null,
      address: body.address,
      service_requested: body.service,
      notes,
      status: companyId ? "offered" : "new"
    }).select("id").single();
    if (error) throw error;

    if (body.preQuoteId) {
      const existingPreQuote = await client.from("lead_center").select("notes").eq("id", body.preQuoteId).maybeSingle();
      if (!existingPreQuote.error && existingPreQuote.data) {
        const closed = await client.from("lead_center").update({
          status: "converted",
          notes: [existingPreQuote.data.notes, `PREQUOTE_COMPLETED_BY:${data.id}`].filter(Boolean).join(" | "),
          updated_at: new Date().toISOString(),
        }).eq("id", body.preQuoteId);
        if (closed.error) console.error("Linked pre-quote could not be closed", closed.error);
      }
    }

    const emailDelivered = await sendQuoteAlert({
      stage: "complete",
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      service: body.service,
      estimatedTotal: body.estimatedTotal ?? null,
      leadId: data.id,
      companyName,
    });

    return NextResponse.json({ saved: true, leadId: data.id, customerId, propertyId, companyName, emailDelivered }, { status: 201 });
  } catch (error) {
    console.error("Quote referral failed", error);
    return NextResponse.json({ error: "Quote referral could not be saved." }, { status: 500 });
  }
}
