import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

const BUCKET = "mobile-assets";
const MANIFEST_PATH = "opening/manifest.json";
const VIDEO_PATH = "opening/current.mp4";
const MAX_BYTES = 20 * 1024 * 1024;

type OpeningManifest = {
  version: string;
  sha256: string;
  durationMs: number;
  updatedAt: string;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Mobile opening storage is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Admin.");
  const client = serviceClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Admin session expired. Sign in again.");
  const { data: profile, error } = await client.from("profiles")
    .select("id,role,active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error || !profile?.active || profile.role !== "admin") throw new Error("Only the company Admin can change the app opening.");
  return client;
}

async function ensureBucket(client: any) {
  const { data, error } = await client.storage.listBuckets();
  if (error) throw new Error(error.message);
  if ((data || []).some((bucket: any) => bucket.name === BUCKET)) return;
  const created = await client.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: ["video/mp4", "application/json"],
  });
  if (created.error) throw new Error(created.error.message);
}

async function readManifest(client: any): Promise<OpeningManifest | null> {
  const { data, error } = await client.storage.from(BUCKET).download(MANIFEST_PATH);
  if (error || !data) return null;
  try {
    const parsed = JSON.parse(await data.text());
    if (!parsed?.version) return null;
    return parsed as OpeningManifest;
  } catch {
    return null;
  }
}

function validMp4(bytes: Buffer) {
  return bytes.length >= 12
    && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}

export async function GET(request: NextRequest) {
  try {
    const client = await requireAdmin(request);
    const manifest = await readManifest(client);
    return NextResponse.json({ configured: Boolean(manifest), manifest });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Opening status could not be loaded." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const client = await requireAdmin(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose an MP4 video.");
    if (file.type && file.type !== "video/mp4") throw new Error("The opening must be an MP4 video.");
    if (file.size < 100_000) throw new Error("The selected video is too small or invalid.");
    if (file.size > MAX_BYTES) throw new Error("The opening must be smaller than 20 MB.");

    const bytes = Buffer.from(await file.arrayBuffer());
    if (!validMp4(bytes)) throw new Error("This file is not a valid MP4. Export it as H.264 MP4 and try again.");

    const durationMs = Math.max(1000, Math.min(15000, Number(form.get("durationMs") || 5000)));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const version = `${Date.now()}-${sha256.slice(0, 10)}`;
    const manifest: OpeningManifest = { version, sha256, durationMs, updatedAt: new Date().toISOString() };

    await ensureBucket(client);
    const videoUpload = await client.storage.from(BUCKET).upload(VIDEO_PATH, bytes, {
      upsert: true,
      contentType: "video/mp4",
      cacheControl: "3600",
    });
    if (videoUpload.error) throw new Error(videoUpload.error.message);

    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const manifestUpload = await client.storage.from(BUCKET).upload(MANIFEST_PATH, manifestBytes, {
      upsert: true,
      contentType: "application/json",
      cacheControl: "0",
    });
    if (manifestUpload.error) throw new Error(manifestUpload.error.message);

    return NextResponse.json({ saved: true, manifest });
  } catch (error) {
    console.error("admin-mobile-opening-post", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Opening video could not be saved." }, { status: 400 });
  }
}
