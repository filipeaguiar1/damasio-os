import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const propertyDetails = z.object({
  lawnSize: z.enum(["xs", "small", "medium", "large", "legacy", "oversize"]),
  grassHeight: z.enum(["2in", "3in", "4in", "5in"]),
  grassHandling: z.enum(["mulched", "bag_green_bin", "bag_leave_property", "no_preference"]),
  backyard: z.boolean(),
  gated: z.boolean(),
  annual: z.boolean(),
}).strict();

const quoteReferral = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).optional().default(""),
  address: z.string().trim().min(5).max(300),
  service: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(1500).optional().default(""),
  referralCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/).optional().or(z.literal("")),
  estimatedTotal: z.number().nonnegative().nullable().optional(),
  propertyDetails: propertyDetails.optional(),
  website: z.string().max(0).optional()
}).strict();

function propertyValues(details?: z.infer<typeof propertyDetails>) {
  if (!details) return {};
  const propertyNotes = [
    `Grass handling: ${details.grassHandling.replaceAll("_", " ")}`,
    `Backyard: ${details.backyard ? "Yes" : "No"}`,
    `Annual plan: ${details.annual ? "Yes" : "No"}`,
  ].join(" | ");
  return {
    lot_size: details.lawnSize,
    grass_height: details.grassHeight,
    gate: details.gated,
    property_notes: propertyNotes,
  };
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

    return NextResponse.json({ saved: true, leadId: data.id, customerId, propertyId, companyName }, { status: 201 });
  } catch (error) {
    console.error("Quote referral failed", error);
    return NextResponse.json({ error: "Quote referral could not be saved." }, { status: 500 });
  }
}
