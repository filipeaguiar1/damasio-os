import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const BUCKET = "mobile-assets";
const MANIFEST_PATH = "opening/manifest.json";
const VIDEO_PATH = "opening/current.mp4";

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

async function readManifest(client: any): Promise<OpeningManifest | null> {
  const { data, error } = await client.storage.from(BUCKET).download(MANIFEST_PATH);
  if (error || !data) return null;
  try {
    const text = await data.text();
    const parsed = JSON.parse(text);
    if (!parsed?.version || !parsed?.sha256) return null;
    return {
      version: String(parsed.version),
      sha256: String(parsed.sha256),
      durationMs: Math.max(1000, Math.min(15000, Number(parsed.durationMs || 5000))),
      updatedAt: String(parsed.updatedAt || ""),
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const client = serviceClient();
    const manifest = await readManifest(client);
    if (!manifest) {
      return NextResponse.json(
        { version: null, url: null, sha256: null, durationMs: 0 },
        { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } },
      );
    }

    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(VIDEO_PATH, 60 * 60);
    if (error || !data?.signedUrl) throw new Error(error?.message || "Opening video URL could not be created.");

    return NextResponse.json(
      { ...manifest, url: `${data.signedUrl}${data.signedUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(manifest.version)}` },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } },
    );
  } catch (error) {
    console.error("mobile-opening-get", error);
    return NextResponse.json(
      { version: null, url: null, sha256: null, durationMs: 0 },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
