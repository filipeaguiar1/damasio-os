import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Property photo upload is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireCustomerProperty(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in before updating the property photo.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");
  const email = String(auth.user.email || "").toLowerCase();
  const { data: customer, error: customerError } = await client.from("customers").select("id").or(`profile_id.eq.${auth.user.id},email.ilike.${email.replace(/,/g, "")}`).limit(1).maybeSingle();
  if (customerError || !customer) throw new Error(customerError?.message || "Customer account could not be found.");
  const { data: property, error: propertyError } = await client.from("properties").select("id,company_id").eq("customer_id", customer.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (propertyError || !property) throw new Error(propertyError?.message || "Property could not be found.");
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
    return NextResponse.json({ error: error instanceof Error ? error.message : "Property photo could not be saved." }, { status: 400 });
  }
}
