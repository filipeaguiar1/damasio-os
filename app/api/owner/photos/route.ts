import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

async function owner(request: NextRequest) {
  const userId = process.env.FOREVER_OWNER_USER_ID;
  const companyId = process.env.FOREVER_COMPANY_ID;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!userId || !companyId || !url || !key) return null;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error } = await db.auth.getUser(token);
  if (error || auth.user?.id !== userId) return null;
  const { data: profile } = await db.from("profiles").select("active,role").eq("id", userId).maybeSingle();
  if (!profile?.active || !["admin", "master"].includes(profile.role)) return null;
  return { db, companyId, userId };
}

export async function GET(request: NextRequest) {
  const actor = await owner(request);
  if (!actor) return fail("Owner authorization required.", 403);
  const photoId = request.nextUrl.searchParams.get("id") || "";
  if (!uuid(photoId)) return fail("Invalid photo.", 400);

  const { data: photo, error } = await actor.db.from("photos")
    .select("id,property_id,storage_bucket,storage_path")
    .eq("id", photoId).eq("organization_id", actor.companyId).maybeSingle();
  if (error || !photo?.property_id) return fail("Photo not found.", 404);
  const { data: property } = await actor.db.from("properties").select("id")
    .eq("id", photo.property_id).eq("organization_id", actor.companyId).maybeSingle();
  if (!property) return fail("Photo not found.", 404);
  const signed = await actor.db.storage.from(photo.storage_bucket).createSignedUrl(photo.storage_path, 600);
  if (signed.error || !signed.data?.signedUrl) return fail("Photo could not be opened.", 500);
  return NextResponse.json({ url: signed.data.signedUrl }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const actor = await owner(request);
  if (!actor) return fail("Owner authorization required.", 403);
  try {
    const form = await request.formData();
    const visitId = String(form.get("visitId") || "");
    const type = String(form.get("type") || "");
    const caption = String(form.get("caption") || "").trim().slice(0, 300);
    const file = form.get("file");
    if (!uuid(visitId) || !["before", "after", "completion", "issue"].includes(type)) return fail("Invalid visit or photo type.", 400);
    if (!(file instanceof File) || file.size === 0 || file.size > 6 * 1024 * 1024) return fail("Choose an image under 6 MB.", 400);
    const accepted = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);
    const extension = accepted.get(file.type);
    if (!extension) return fail("Use a JPEG, PNG or WebP image.", 400);

    const { data: visit, error } = await actor.db.from("visits")
      .select("id,property_id").eq("id", visitId).eq("organization_id", actor.companyId).maybeSingle();
    if (error || !visit?.property_id) return fail("Visit not found.", 404);
    const { data: property } = await actor.db.from("properties").select("id")
      .eq("id", visit.property_id).eq("organization_id", actor.companyId).maybeSingle();
    if (!property) return fail("Property not found.", 404);

    const bucket = "work-photos";
    const path = actor.companyId + "/" + visit.property_id + "/" + visitId + "/" + randomUUID() + "." + extension;
    const uploaded = await actor.db.storage.from(bucket).upload(
      path, new Uint8Array(await file.arrayBuffer()),
      { contentType: file.type, upsert: false }
    );
    if (uploaded.error) throw uploaded.error;
    const inserted = await actor.db.from("photos").insert({
      organization_id: actor.companyId,
      company_id: actor.companyId,
      property_id: visit.property_id,
      visit_id: visitId,
      uploaded_by: actor.userId,
      storage_path: path,
      storage_bucket: bucket,
      photo_type: type,
      is_profile: false,
      caption: caption || null,
    }).select("id").single();
    if (inserted.error) {
      await actor.db.storage.from(bucket).remove([path]);
      throw inserted.error;
    }
    return NextResponse.json({ id: inserted.data.id }, { status: 201 });
  } catch (error) {
    console.error("Owner photo upload failed", error);
    return fail("Could not save the photo.", 500);
  }
}
