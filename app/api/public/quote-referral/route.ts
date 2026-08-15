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
  website: z.string().max(0).optional(),
}).strict();

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

    // Public traffic may create a lead, but it must never create or mutate the
    // canonical Customer/Property graph. A valid company code only pre-selects
    // the intended company for Master review; the company does not receive the
    // referral until Master explicitly responds and moves the lead to offered.
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
      status: "new",
    });

    if (error) throw error;

    // The public UI only needs confirmation and the routed company name. Do not
    // disclose internal lead/customer/property identifiers to unauthenticated callers.
    return NextResponse.json({ saved: true, companyName }, { status: 201 });
  } catch (error) {
    console.error("Quote referral failed", error);
    return NextResponse.json({ error: "Quote referral could not be saved." }, { status: 500 });
  }
}
