import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address) return NextResponse.json({ error: "Address is required." }, { status: 400 });

  const query = /ontario|\bon\b|canada/i.test(address) ? address : `${address}, Hamilton, Ontario, Canada`;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ca");
  url.searchParams.set("addressdetails", "1");

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-CA,en;q=0.9",
        "User-Agent": "DamasioOS/51.4 route-map-test"
      },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
    const results = (await response.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
    const match = results[0];
    if (!match) return NextResponse.json({ error: "Address not found." }, { status: 404 });
    return NextResponse.json({
      latitude: Number(match.lat),
      longitude: Number(match.lon),
      displayName: match.display_name || address
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Geocoding failed." }, { status: 502 });
  }
}
