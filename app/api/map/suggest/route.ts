import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SERVICE_VIEWBOX = "-80.35,43.65,-79.35,42.85";

type Suggestion = { id: string; label: string; latitude: number; longitude: number };

type NominatimMatch = {
  place_id?: number;
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
};

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

function normalizePostal(value?: string) {
  return String(value || "").toUpperCase().replace(/\s+/g, "").replace(/^(.{3})(.{3})$/, "$1 $2");
}

function nominatimLabel(match: NominatimMatch) {
  const address = match.address || {};
  const street = [address.house_number, address.road].filter(Boolean).join(" ");
  const locality = address.city || address.town || address.village || address.municipality || address.county;
  return [street, locality, address.state, normalizePostal(address.postcode), address.country || "Canada"]
    .filter(Boolean)
    .join(", ");
}

function photonLabel(feature: PhotonFeature) {
  const property = feature.properties || {};
  const street = [property.housenumber, property.street || property.name].filter(Boolean).join(" ");
  return [street, property.city || property.district, property.state, normalizePostal(property.postcode), property.country]
    .filter(Boolean)
    .join(", ");
}

async function searchNominatim(query: string): Promise<Suggestion[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", /canada|ontario|\bon\b/i.test(query) ? query : `${query}, Ontario, Canada`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("countrycodes", "ca");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("viewbox", SERVICE_VIEWBOX);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en-CA,en;q=0.9",
      "User-Agent": "4EverSeasons/1.0 address-suggestions",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) return [];
  const rows = await response.json() as NominatimMatch[];
  return rows.flatMap(match => {
    const latitude = Number(match.lat);
    const longitude = Number(match.lon);
    const label = nominatimLabel(match) || match.display_name || "";
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !label) return [];
    return [{ id: String(match.place_id || `${longitude}:${latitude}`), label, latitude, longitude }];
  });
}

async function searchPhoton(query: string): Promise<Suggestion[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", /canada|ontario|\bon\b/i.test(query) ? query : `${query}, Ontario, Canada`);
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", "en");
  url.searchParams.set("lat", "43.2557");
  url.searchParams.set("lon", "-79.8711");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "4EverSeasons/1.0 address-suggestions" },
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) return [];
  const data = await response.json() as { features?: PhotonFeature[] };
  return (data.features || []).flatMap(feature => {
    const coordinates = feature.geometry?.coordinates;
    const label = photonLabel(feature);
    const countryCode = feature.properties?.countrycode?.toLowerCase();
    if (!coordinates || !label || (countryCode && countryCode !== "ca")) return [];
    return [{ id: String(feature.properties?.osm_id || `${coordinates[0]}:${coordinates[1]}`), label, longitude: coordinates[0], latitude: coordinates[1] }];
  });
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  if (query.length < 3) return NextResponse.json({ suggestions: [] });
  if (query.length > 160) return NextResponse.json({ error: "Search is too long." }, { status: 400 });

  try {
    const primary = await searchNominatim(query);
    if (primary.length) return NextResponse.json({ suggestions: primary });
    return NextResponse.json({ suggestions: await searchPhoton(query) });
  } catch {
    try {
      return NextResponse.json({ suggestions: await searchPhoton(query) });
    } catch {
      return NextResponse.json({ suggestions: [] });
    }
  }
}
