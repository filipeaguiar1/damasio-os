import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    housenumber?: string;
    street?: string;
    name?: string;
    city?: string;
    district?: string;
    state?: string;
    postcode?: string;
    country?: string;
    countrycode?: string;
  };
};

function labelFor(feature: PhotonFeature) {
  const property = feature.properties || {};
  const street = [property.housenumber, property.street || property.name].filter(Boolean).join(" ");
  return [street, property.city || property.district, property.state, property.postcode, property.country]
    .filter(Boolean).join(", ");
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  if (query.length < 3) return NextResponse.json({ suggestions: [] });
  if (query.length > 160) return NextResponse.json({ error: "Search is too long." }, { status: 400 });

  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", /canada|ontario|\bon\b/i.test(query) ? query : `${query}, Ontario, Canada`);
    url.searchParams.set("limit", "6");
    url.searchParams.set("lang", "en");
    url.searchParams.set("lat", "43.2557");
    url.searchParams.set("lon", "-79.8711");

    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "DamasioOS/51.4 address-suggestions" },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) throw new Error(`Address provider returned ${response.status}`);
    const data = await response.json() as { features?: PhotonFeature[] };
    const suggestions = (data.features || []).flatMap(feature => {
      const coordinates = feature.geometry?.coordinates;
      const label = labelFor(feature);
      const countryCode = feature.properties?.countrycode?.toLowerCase();
      if (!coordinates || !label || (countryCode && countryCode !== "ca")) return [];
      return [{ id: String(feature.properties?.osm_id || `${coordinates[0]}:${coordinates[1]}`), label, longitude: coordinates[0], latitude: coordinates[1] }];
    });
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
