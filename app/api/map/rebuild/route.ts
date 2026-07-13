import { NextRequest, NextResponse } from "next/server";
import { rebuildPendingRouteMaps } from "@/lib/maps/routeRebuildService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const results = await rebuildPendingRouteMaps(10);
    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Route rebuild failed" }, { status: 500 });
  }
}
