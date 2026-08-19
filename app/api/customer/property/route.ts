import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

const schema = z.object({ customerComment: z.string().trim().max(1500).nullable().optional() }).strict();

async function requireCustomerProperty(request: NextRequest) {
  const { service, customer, identity } = await requireCustomerPortalIdentity(request);
  if (!customer) throw new Error("Customer account could not be found.");

  let query = service
    .from("properties")
    .select("id,address_line1,city,province,postal_code,lot_size,grass_height,gate,dog,irrigation,access_notes,property_notes,customer_comment,official_photo_url,company_id,organization_id")
    .eq("customer_id", identity.customerId);

  if (identity.companyId) {
    query = query.or(`company_id.eq.${identity.companyId},organization_id.eq.${identity.companyId}`);
  }

  const { data: property, error } = await query
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !property) throw new Error(error?.message || "Property could not be found.");
  return { client: service, customer, property, identity };
}

async function signedPropertyPhoto(client: any, path?: string | null) {
  if (!path) return null;
  const { data, error } = await client.storage.from("property-photos").createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl || null;
}

export async function GET(request: NextRequest) {
  try {
    const { client, customer, property } = await requireCustomerProperty(request);
    return NextResponse.json({
      property: {
        propertyId: property.id,
        customerName: customer.full_name || "Customer",
        email: customer.email || null,
        phone: customer.phone || null,
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
        photoUrl: await signedPropertyPhoto(client, property.official_photo_url),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Property could not be loaded." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const { client, property, identity } = await requireCustomerProperty(request);
    let update = client
      .from("properties")
      .update({ customer_comment: body.customerComment || null })
      .eq("id", property.id)
      .eq("customer_id", identity.customerId);
    if (identity.companyId) {
      update = update.or(`company_id.eq.${identity.companyId},organization_id.eq.${identity.companyId}`);
    }
    const { error } = await update;
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Property comment could not be saved." }, { status: 400 });
  }
}
