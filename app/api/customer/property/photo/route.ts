import { NextRequest, NextResponse } from "next/server";
import { requireCustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function requireCustomerProperty(request: NextRequest) {
  const session = await requireCustomerPortalIdentity(request);
  const { service, identity } = session;
  const result = await service
    .from("properties")
    .select("id,company_id,organization_id,customer_id")
    .eq("customer_id", identity.customerId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (result.error || !result.data) {
    throw new Error(result.error?.message || "Property could not be found for this Customer.");
  }

  const companyId = result.data.company_id || result.data.organization_id || identity.companyId;
  if (!companyId) throw new Error("Property has no company identity.");
  if (identity.companyId && String(identity.companyId) !== String(companyId)) {
    throw new Error("Property belongs to a different company.");
  }

  return {
    ...session,
    property: result.data,
    companyId: String(companyId),
  };
}

function statusFor(message: string) {
  return /session expired|sign in/i.test(message) ? 401 : /different|only an active|not linked/i.test(message) ? 403 : 400;
}

export async function POST(request: NextRequest) {
  try {
    const { service, property, companyId, identity } = await requireCustomerProperty(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a valid image.");

    const contentType = file.type.toLowerCase();
    const ext = EXTENSION_BY_MIME[contentType];
    if (!ext) throw new Error("Use an AVIF, HEIC, HEIF, JPEG, PNG or WebP image.");
    if (file.size <= 0 || file.size > 8 * 1024 * 1024) {
      throw new Error("Image must be between 1 byte and 8 MB.");
    }

    const path = `${companyId}/${property.id}/profile.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await service.storage.from("property-photos").upload(path, bytes, {
      upsert: true,
      contentType,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { error: deleteError } = await service
      .from("photos")
      .delete()
      .eq("property_id", property.id)
      .eq("is_profile", true);
    if (deleteError) throw new Error(deleteError.message);

    const { error: photoError } = await service.from("photos").insert({
      organization_id: companyId,
      company_id: companyId,
      property_id: property.id,
      uploaded_by: identity.profileId,
      storage_path: path,
      storage_bucket: "property-photos",
      public_url: null,
      photo_type: "property",
      is_profile: true,
    });
    if (photoError) throw new Error(photoError.message);

    let update = service
      .from("properties")
      .update({ official_photo_url: path })
      .eq("id", property.id)
      .eq("customer_id", identity.customerId);
    if (identity.companyId) {
      update = update.or(`company_id.eq.${identity.companyId},organization_id.eq.${identity.companyId}`);
    }
    const { error: propertyUpdateError } = await update;
    if (propertyUpdateError) throw new Error(propertyUpdateError.message);

    const { data: signed, error: signedError } = await service.storage.from("property-photos").createSignedUrl(path, 3600);
    if (signedError || !signed?.signedUrl) {
      throw new Error(signedError?.message || "Photo was saved but could not be displayed.");
    }
    return NextResponse.json({ saved: true, url: signed.signedUrl });
  } catch (error) {
    console.error("Customer property photo failed", error);
    const message = error instanceof Error ? error.message : "Property photo could not be saved.";
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
