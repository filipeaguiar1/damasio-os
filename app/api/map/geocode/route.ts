import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function searchCandidates(value: string) {
  const normalized = value
    .replace(/\s+-\s+/g, ", ")
    .replace(/\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/gi, "$1 $2")
    .replace(/\brd\b/gi, "Road")
    .replace(/\bst\b/gi, "Street")
    .replace(/\bON\b/gi, "Ontario")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  const withCountry = /canada/i.test(normalized) ? normalized : `${normalized}, Canada`;
  const withoutPostal = withCountry.replace(/,?\s*[A-Z]\d[A-Z]\s\d[A-Z]\d(?=,|$)/i, "");
  const hamiltonFallback = withoutPostal.replace(/\bMount Hope\b/i, "Hamilton");
  const roadFallback = hamiltonFallback.replace(/^\d+\s+/, "");
  return [...new Set([withCountry, withoutPostal, hamiltonFallback, roadFallback])];
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address) return NextResponse.json({ error: "Address is required." }, { status: 400 });
  if (address.length > 240) return NextResponse.json({ error: "Address is too long." }, { status: 400 });

  try {
    let match: { lat: string; lon: string; display_name?: string } | undefined;
    const candidates = searchCandidates(address);
    for (const query of candidates.slice(0, -1)) {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      url.searchParams.set("countrycodes", "ca");
      url.searchParams.set("addressdetails", "1");
      const response = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": "en-CA,en;q=0.9", "User-Agent": "DamasioOS/51.4 route-map-test" }, next: { revalidate: 86400 } });
      if (!response.ok) continue;
      const results = (await response.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
      match = results[0];
      if (match) break;
    }
    if (!match) {
      const photon = new URL("https://photon.komoot.io/api/");
      photon.searchParams.set("q", candidates[0]);
      photon.searchParams.set("limit", "1");
      photon.searchParams.set("lang", "en");
      const response = await fetch(photon, { headers: { Accept: "application/json", "User-Agent": "DamasioOS/51.4 route-map-test" }, next: { revalidate: 86400 } });
      if (response.ok) {
        const data = await response.json() as { features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: { name?: string; city?: string; state?: string } }> };
        const feature = data.features?.[0];
        const point = feature?.geometry?.coordinates;
        if (point) match = { lon: String(point[0]), lat: String(point[1]), display_name: [feature?.properties?.name, feature?.properties?.city, feature?.properties?.state].filter(Boolean).join(", ") };
      }
    }
    if (!match) {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", candidates[candidates.length - 1]);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      url.searchParams.set("countrycodes", "ca");
      const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "DamasioOS/51.4 route-map-test" }, next: { revalidate: 86400 } });
      if (response.ok) match = ((await response.json()) as Array<{ lat: string; lon: string; display_name?: string }>)[0];
    }
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
