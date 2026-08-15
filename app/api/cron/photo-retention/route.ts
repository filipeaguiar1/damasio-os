import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const RETENTION_DAYS = 90;
const BATCH_SIZE = 250;
const MAX_BATCHES = 20;
const OPERATIONAL_BUCKETS = ["work-photos", "task-photos", "before-after"] as const;

function authorize(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    throw new Error("Unauthorized photo-retention request.");
  }
}

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Photo retention worker is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
}

type ExpiredPhoto = {
  id: string;
  storage_bucket: string;
  storage_path: string;
};

async function removeBatch(client: any, rows: ExpiredPhoto[]) {
  const removedIds: string[] = [];

  for (const bucket of OPERATIONAL_BUCKETS) {
    const bucketRows = rows.filter((row) => row.storage_bucket === bucket);
    if (!bucketRows.length) continue;

    const paths = bucketRows.map((row) => row.storage_path).filter(Boolean);
    if (paths.length) {
      const { error: storageError } = await client.storage.from(bucket).remove(paths);
      if (storageError) throw new Error(`${bucket} cleanup failed: ${storageError.message}`);
    }
    removedIds.push(...bucketRows.map((row) => row.id));
  }

  if (removedIds.length) {
    const { error: rowError } = await client.from("photos").delete().in("id", removedIds);
    if (rowError) throw new Error(`Photo metadata cleanup failed: ${rowError.message}`);
  }

  return removedIds.length;
}

export async function GET(request: NextRequest) {
  try {
    authorize(request);
    const client = serverClient();
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    let removed = 0;
    let batches = 0;

    while (batches < MAX_BATCHES) {
      const { data, error } = await client
        .from("photos")
        .select("id,storage_bucket,storage_path")
        .eq("is_profile", false)
        .in("storage_bucket", [...OPERATIONAL_BUCKETS])
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(BATCH_SIZE);

      if (error) throw new Error(error.message);
      const rows = (data || []) as ExpiredPhoto[];
      if (!rows.length) break;

      removed += await removeBatch(client, rows);
      batches += 1;
      if (rows.length < BATCH_SIZE) break;
    }

    return NextResponse.json({
      ok: true,
      retentionDays: RETENTION_DAYS,
      cutoff,
      removed,
      batches,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Photo retention failed.";
    return NextResponse.json(
      { error: message },
      { status: message.startsWith("Unauthorized") ? 401 : 500 },
    );
  }
}
