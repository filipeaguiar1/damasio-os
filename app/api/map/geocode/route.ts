import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SERVICE_CENTER = { latitude: 43.2557, longitude: -79.8711 };
const SERVICE_VIEWBOX = "-80.35,43.65,-79.35,42.85";
const SERVICE_BBOX = "-80.35,42.85,-79.35,43.65";
const LOCALITY_WORDS = [
  "Hamilton",
  "Burlington",
  "Oakville",
  "Milton",
  "Dundas",
  "Ancaster",
  "Stoney Creek",
  "Waterdown",
  "Flamborough",
  "Mount Hope",
  "Grimsby",
  "Brantford",
];

type NominatimMatch = {
  lat: string;
  lon: string;
  display_name?: string;
  importance?: number;
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
  };
};

function normalizeAddress(value: string) {
  return value
    .replace(/\s+-\s+/g, ", ")
    .replace(/\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/gi, "$1 $2")
    .replace(/\brd\b/gi, "Road")
    .replace(/\bst\b/gi, "Street")
    .replace(/\bave\b/gi, "Avenue")
    .replace(/\bblvd\b/gi, "Boulevard")
    .replace(/\bON\b/gi, "Ontario")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasExplicitLocality(value: string) {
  if (/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i.test(value)) return true;
  if (/\bOntario\b/i.test(value)) return true;
  return LOCALITY_WORDS.some(city => value.toLowerCase().includes(city.toLowerCase()));
}

function searchCandidates(value: string) {
  const normalized = normalizeAddress(value);
  const withCountry = /\bcanada\b/i.test(normalized) ? normalized : `${normalized}, Canada`;
  const withoutPostal = withCountry.replace(/,?\s*[A-Z]\d[A-Z]\s\d[A-Z]\d(?=,|$)/i, "");
  const mountHopeAsHamilton = withoutPostal.replace(/\bMount Hope\b/i, "Hamilton");
  const roadFallback = mountHopeAsHamilton.replace(/^\d+[A-Za-z]?\s+/, "");
  return [...new Set([withCountry, withoutPostal, mountHopeAsHamilton, roadFallback])];
}

function distanceSquared(match: NominatimMatch) {
  const latitude = Number(match.lat);
  const longitude = Number(match.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return Number.POSITIVE_INFINITY;
  const x = (longitude - SERVICE_CENTER.longitude)
    * Math.cos((latitude + SERVICE_CENTER.latitude) * Math.PI / 360);
  const y = latitude - SERVICE_CENTER.latitude;
  return x * x + y * y;
}

function meaningfulStreetTokens(value: string) {
  const firstPart = normalizeAddress(value).split(",")[0] || "";
  return firstPart
    .replace(/^\d+[A-Za-z]?\s+/, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(token => token.length > 2 && !["street", "road", "avenue", "boulevard", "drive", "lane"].includes(token));
}

function scoreMatch(match: NominatimMatch, input: string) {
  const display = String(match.display_name || "").toLowerCase();
  const inputLower = normalizeAddress(input).toLowerCase();
  const requestedNumber = inputLower.match(/^\s*(\d+[a-z]?)/)?.[1];
  const matchedNumber = String(match.address?.house_number || "").toLowerCase();
  let score = Number(match.importance || 0) * 10;

  if (requestedNumber && matchedNumber === requestedNumber) score += 120;
  for (const token of meaningfulStreetTokens(input)) {
    if (display.includes(token)) score += 18;
  }
  for (const locality of LOCALITY_WORDS) {
    if (inputLower.includes(locality.toLowerCase()) && display.includes(locality.toLowerCase())) score += 80;
  }
  if (inputLower.includes("ontario") && display.includes("ontario")) score += 25;
  if (/\bcanada\b/i.test(display)) score += 5;

  // Within the operating area, prefer the closest exact street result instead
  // of a similarly named address in Vaughan/Toronto when the city is omitted.
  score -= Math.min(distanceSquared(match) * 500, 80);
  return score;
}

function chooseBest(matches: NominatimMatch[], input: string) {
  return [...matches]
    .filter(match => Number.isFinite(Number(match.lat)) && Number.isFinite(Number(match.lon)))
    .sort((left, right) => scoreMatch(right, input) - scoreMatch(left, input))[0];
}

async function searchNominatim(query: string, input: string, bounded: boolean) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "10");
  url.searchParams.set("countrycodes", "ca");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("viewbox", SERVICE_VIEWBOX);
  if (bounded) url.searchParams.set("bounded", "1");
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en-CA,en;q=0.9",
      "User-Agent": "DamasioOS/51.4 canonical-route-map",
    },
    cache: "no-store",
  });
  if (!response.ok) return undefined;
  return chooseBest((await response.json()) as NominatimMatch[], input);
}

async function searchPhoton(query: string) {
  const photon = new URL("https://photon.komoot.io/api/");
  photon.searchParams.set("q", query);
  photon.searchParams.set("limit", "10");
  photon.searchParams.set("lang", "en");
  photon.searchParams.set("lat", String(SERVICE_CENTER.latitude));
  photon.searchParams.set("lon", String(SERVICE_CENTER.longitude));
  photon.searchParams.set("bbox", SERVICE_BBOX);
  const response = await fetch(photon, {
    headers: { Accept: "application/json", "User-Agent": "DamasioOS/51.4 canonical-route-map" },
    cache: "no-store",
  });
  if (!response.ok) return undefined;
  const data = await response.json() as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: { name?: string; city?: string; state?: string; postcode?: string; country?: string };
    }>;
  };
  const feature = data.features?.[0];
  const point = feature?.geometry?.coordinates;
  if (!point) return undefined;
  return {
    lon: String(point[0]),
    lat: String(point[1]),
    display_name: [
      feature?.properties?.name,
      feature?.properties?.city,
      feature?.properties?.state,
      feature?.properties?.postcode,
      feature?.properties?.country,
    ].filter(Boolean).join(", "),
  } satisfies NominatimMatch;
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address) return NextResponse.json({ error: "Address is required." }, { status: 400 });
  if (address.length > 240) return NextResponse.json({ error: "Address is too long." }, { status: 400 });

  try {
    const candidates = searchCandidates(address);
    const explicitLocality = hasExplicitLocality(address);
    let match: NominatimMatch | undefined;

    for (const query of candidates.slice(0, -1)) {
      match = await searchNominatim(query, address, !explicitLocality);
      if (match) break;
    }
    if (!match) match = await searchPhoton(candidates[0]);
    if (!match) match = await searchNominatim(candidates[candidates.length - 1], address, true);
    if (!match) return NextResponse.json({ error: "Address not found." }, { status: 404 });

    return NextResponse.json({
      latitude: Number(match.lat),
      longitude: Number(match.lon),
      displayName: match.display_name || address,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Geocoding failed.",
    }, { status: 502 });
  }
}
