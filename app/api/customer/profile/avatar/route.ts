import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Customer avatar upload is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function extension(name: string) {
  const value = name.split(".").pop()?.toLowerCase();
  return value && /^(avif|heic|heif|jpe?g|png|webp)$/.test(value) ? value : "jpg";
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Sign in before updating your profile photo.");
    const client = serverClient();
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");

    const email = String(auth.user.email || "").toLowerCase();
    const { data: customer, error: customerError } = await client
      .from("customers")
      .select("id,company_id")
      .or(`profile_id.eq.${auth.user.id},email.ilike.${email.replace(/,/g, "")}`)
      .limit(1)
      .maybeSingle();
    if (customerError || !customer) throw new Error(customerError?.message || "Customer account could not be found.");

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a valid image.");
    if (!file.type.startsWith("image/")) throw new Error("The selected file must be an image.");
    if (file.size > 8 * 1024 * 1024) throw new Error("Image must be smaller than 8 MB.");

    const path = `${customer.company_id}/${customer.id}/customer-avatar.${extension(file.name)}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await client.storage.from("property-photos").upload(path, bytes, {
      upsert: true,
      contentType: file.type || "image/jpeg",
    });
    if (uploadError) throw new Error(uploadError.message);

    const metadata = { ...(auth.user.user_metadata || {}), customer_avatar_path: path };
    const { error: metadataError } = await client.auth.admin.updateUserById(auth.user.id, { user_metadata: metadata });
    if (metadataError) throw new Error(metadataError.message);

    const { data: signed, error: signedError } = await client.storage.from("property-photos").createSignedUrl(path, 3600);
    if (signedError || !signed?.signedUrl) throw new Error(signedError?.message || "Photo was saved but could not be displayed.");

    return NextResponse.json({ saved: true, url: signed.signedUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Profile photo could not be saved." }, { status: 400 });
  }
}
