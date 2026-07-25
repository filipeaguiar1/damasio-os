import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Property photo upload is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function resolveCustomerProperty(client: any, userId: string, email: string) {
  const { data: customers, error: customerError } = await client
    .from("customers")
    .select("id,company_id,organization_id,profile_id,email")
    .ilike("email", email)
    .order("created_at", { ascending: true });
  if (customerError) throw new Error(customerError.message);

  const rows = customers || [];
  const authenticatedCustomer = rows.find((row: any) => row.profile_id === userId) || rows[0];
  if (!authenticatedCustomer) throw new Error("Customer account could not be found.");
  const companyId = authenticatedCustomer.company_id || authenticatedCustomer.organization_id;

  const customerIds = rows
    .filter((row: any) => (row.company_id || row.organization_id) === companyId)
    .map((row: any) => row.id);

  let property: any = null;
  if (customerIds.length) {
    const result = await client
      .from("properties")
      .select("id,company_id,customer_id")
      .in("customer_id", customerIds)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    property = result.data;
  }

  if (!property) {
    const lead = await client
      .from("lead_center")
      .select("property_id,customer_id,assigned_company_id")
      .ilike("email", email)
      .eq("assigned_company_id", companyId)
      .not("property_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lead.error) throw new Error(lead.error.message);
    if (lead.data?.property_id) {
      const result = await client
        .from("properties")
        .select("id,company_id,customer_id")
        .eq("id", lead.data.property_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      property = result.data;
    }
  }

  if (!property) throw new Error("Property could not be found. Submit the quote again with the same account email and company code.");

  if (property.customer_id !== authenticatedCustomer.id) {
    const { error: linkError } = await client
      .from("properties")
      .update({ customer_id: authenticatedCustomer.id, updated_at: new Date().toISOString() })
      .eq("id", property.id)
      .eq("company_id", companyId);
    if (linkError) throw new Error(linkError.message);
  }

  if (authenticatedCustomer.profile_id !== userId) {
    const { error: profileError } = await client
      .from("customers")
      .update({ profile_id: userId })
      .eq("id", authenticatedCustomer.id);
    if (profileError) throw new Error(profileError.message);
  }

  return { ...property, customer_id: authenticatedCustomer.id, company_id: companyId };
}

async function requireCustomerProperty(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in before updating the property photo.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");
  const email = String(auth.user.email || "").trim().toLowerCase();
  if (!email) throw new Error("Customer email could not be verified.");
  const property = await resolveCustomerProperty(client, auth.user.id, email);
  return { client, property, userId: auth.user.id };
}

function extension(name: string) {
  const value = name.split(".").pop()?.toLowerCase();
  return value && /^(avif|heic|heif|jpe?g|png|webp)$/.test(value) ? value : "jpg";
}

export async function POST(request: NextRequest) {
  try {
    const { client, property, userId } = await requireCustomerProperty(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a valid image.");
    if (!file.type.startsWith("image/")) throw new Error("Choose a valid image file.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Image must be smaller than 10 MB.");

    const path = `${property.company_id}/${property.id}/profile.${extension(file.name)}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await client.storage.from("property-photos").upload(path, bytes, { upsert: true, contentType: file.type || "image/jpeg" });
    if (uploadError) throw new Error(uploadError.message);

    await client.from("photos").delete().eq("property_id", property.id).eq("is_profile", true);
    const { error: photoError } = await client.from("photos").insert({
      organization_id: property.company_id,
      company_id: property.company_id,
      property_id: property.id,
      uploaded_by: userId,
      storage_path: path,
      storage_bucket: "property-photos",
      public_url: null,
      photo_type: "property",
      is_profile: true,
    });
    if (photoError) throw new Error(photoError.message);

    const { error: propertyUpdateError } = await client.from("properties").update({ official_photo_url: path, updated_at: new Date().toISOString() }).eq("id", property.id);
    if (propertyUpdateError) throw new Error(propertyUpdateError.message);

    const { data: signed, error: signedError } = await client.storage.from("property-photos").createSignedUrl(path, 3600);
    if (signedError || !signed?.signedUrl) throw new Error(signedError?.message || "Photo was saved but could not be displayed.");
    return NextResponse.json({ saved: true, url: signed.signedUrl });
  } catch (error) {
    console.error("Customer property photo failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Property photo could not be saved." }, { status: 400 });
  }
}
