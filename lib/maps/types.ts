export type Position = [longitude: number, latitude: number];

export type RouteLineString = {
  type: "LineString";
  coordinates: Position[];
};

export type RouteBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type RouteMapCache = {
  routeId: string;
  geometry: RouteLineString | null;
  bounds: RouteBounds | null;
  status: "pending" | "ready" | "failed";
  rebuiltAt: string | null;
};
