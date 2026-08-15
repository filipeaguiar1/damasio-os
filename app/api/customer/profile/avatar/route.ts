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

export async function POST(request: NextRequest) {
  try {
    const { service, user, customer, identity } = await requireCustomerPortalIdentity(request);
    if (!customer || !identity.companyId) throw new Error("Customer account has no company identity.");

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a valid image.");
    const ext = EXTENSION_BY_MIME[file.type.toLowerCase()];
    if (!ext) throw new Error("Use an AVIF, HEIC, HEIF, JPEG, PNG or WebP image.");
    if (file.size <= 0 || file.size > 8 * 1024 * 1024) throw new Error("Image must be between 1 byte and 8 MB.");

    const path = `${identity.companyId}/${identity.customerId}/customer-avatar.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await service.storage.from("property-photos").upload(path, bytes, {
      upsert: true,
      contentType: file.type,
    });
    if (uploadError) throw new Error(uploadError.message);

    const metadata = { ...(user.user_metadata || {}), customer_avatar_path: path };
    const { error: metadataError } = await service.auth.admin.updateUserById(identity.profileId, { user_metadata: metadata });
    if (metadataError) throw new Error(metadataError.message);

    const { data: signed, error: signedError } = await service.storage.from("property-photos").createSignedUrl(path, 3600);
    if (signedError || !signed?.signedUrl) throw new Error(signedError?.message || "Photo was saved but could not be displayed.");

    return NextResponse.json({ saved: true, url: signed.signedUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile photo could not be saved.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
