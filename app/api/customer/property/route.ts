import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

const schema = z.object({ customerComment: z.string().trim().max(1500).nullable().optional() }).strict();

async function requireCustomerProperty(request: NextRequest) {
  const session = await requireCustomerPortalIdentity(request);
  const { service, identity, customer } = session;
  const propertyResult = await service
    .from("properties")
    .select("id,address_line1,city,province,postal_code,lot_size,grass_height,gate,dog,irrigation,access_notes,property_notes,customer_comment,official_photo_url,company_id,organization_id,customer_id")
    .eq("customer_id", identity.customerId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (propertyResult.error || !propertyResult.data) {
    throw new Error(propertyResult.error?.message || "Property could not be found.");
  }

  const propertyCompanyId = propertyResult.data.company_id || propertyResult.data.organization_id || null;
  if (identity.companyId && propertyCompanyId && String(identity.companyId) !== String(propertyCompanyId)) {
    throw new Error("Property belongs to a different company.");
  }

  return { ...session, customer, property: propertyResult.data };
}

async function signedPropertyPhoto(client: any, path?: string | null) {
  if (!path) return null;
  const { data, error } = await client.storage.from("property-photos").createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl || null;
}

function statusFor(message: string) {
  return /session expired|sign in/i.test(message) ? 401 : /different|only an active|not linked/i.test(message) ? 403 : 400;
}

export async function GET(request: NextRequest) {
  try {
    const { service, customer, property } = await requireCustomerProperty(request);
    return NextResponse.json({
      property: {
        propertyId: property.id,
        customerName: customer?.full_name || "Customer",
        email: customer?.email || null,
        phone: customer?.phone || null,
        address: property.address_line1 || "",
        city: property.city || "",
        province: property.province || "",
        postalCode: property.postal_code || null,
        lotSize: property.lot_size || null,
        grassHeight: property.grass_height || null,
        gate: Boolean(property.gate),
        dog: Boolean(property.dog),
        irrigation: Boolean(property.irrigation),
        accessNotes: property.access_notes || null,
        propertyNotes: property.property_notes || null,
        customerComment: property.customer_comment || "",
        photoUrl: await signedPropertyPhoto(service, property.official_photo_url),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Property could not be loaded.";
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const { service, property, identity } = await requireCustomerProperty(request);
    let query = service
      .from("properties")
      .update({ customer_comment: body.customerComment || null })
      .eq("id", property.id)
      .eq("customer_id", identity.customerId);
    if (identity.companyId) {
      query = query.or(`company_id.eq.${identity.companyId},organization_id.eq.${identity.companyId}`);
    }
    const { error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Property comment could not be saved.";
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
