import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Coordinate = [number, number];

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { coordinates?: Coordinate[] };
    const coordinates = body.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 75) {
      return NextResponse.json({ error: "Provide between 2 and 75 route points." }, { status: 400 });
    }
    const clean = coordinates.map(([longitude, latitude]) => [Number(longitude), Number(latitude)] as Coordinate);
    if (clean.some(([longitude, latitude]) => !Number.isFinite(longitude) || !Number.isFinite(latitude))) {
      return NextResponse.json({ error: "Invalid route coordinates." }, { status: 400 });
    }

    const encoded = clean.map(([longitude, latitude]) => `${longitude},${latitude}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${encoded}?overview=full&geometries=geojson&steps=false`;
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`Routing service returned ${response.status}`);
    const data = await response.json() as {
      code?: string;
      routes?: Array<{ geometry: { type: "LineString"; coordinates: Coordinate[] }; distance: number; duration: number }>;
    };
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route) return NextResponse.json({ error: "Road route could not be calculated." }, { status: 404 });
    return NextResponse.json({ geometry: route.geometry, distance: route.distance, duration: route.duration });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Routing failed." }, { status: 502 });
  }
}
