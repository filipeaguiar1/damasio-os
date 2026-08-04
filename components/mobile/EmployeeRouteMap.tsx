"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CanonicalRouteLead } from "@/lib/routes/canonicalRouteIdentity";
import { useCanonicalRouteSnapshot } from "@/lib/hooks/useCanonicalRouteSnapshot";

declare global { interface Window { L?: any } }

type Point = CanonicalRouteLead & {
  latitude: number;
  longitude: number;
  color: string;
  label: string;
};

type Props = {
  route: CanonicalRouteLead[];
  onOpenVisit: (lead: CanonicalRouteLead) => void;
  routeId?: string;
  desktop?: boolean;
  actionLabel?: string;
  originPoint?: { latitude: number; longitude: number; label?: string } | null;
  preview?: boolean;
};

type Coordinates = { latitude: number; longitude: number };

const HAMILTON: [number, number] = [43.2557, -79.8711];

function visualState(lead: CanonicalRouteLead) {
  if (lead.canonicalVisitStatus === "completed" || lead.status === "completed") {
    return { color: "#16a34a", label: "Completed" };
  }
  if (lead.canonicalVisitStatus === "missed") return { color: "#eab308", label: "Skipped" };
  if (lead.canonicalVisitStatus === "in_progress") return { color: "#2563eb", label: "Active" };
  return { color: "#64748b", label: "Pending" };
}

function statusLabel(lead: CanonicalRouteLead) {
  if (lead.canonicalVisitStatus === "completed" || lead.status === "completed") return "Done";
  if (lead.canonicalVisitStatus === "missed") return "Skipped";
  if (lead.canonicalVisitStatus === "in_progress") return "Active";
  return "Scheduled";
}

function normalizeRoute(route: CanonicalRouteLead[]) {
  return [...route]
    .sort((left, right) =>
      (left.routeOrder ?? 9999) - (right.routeOrder ?? 9999)
      || String(left.canonicalVisitId || left.id).localeCompare(String(right.canonicalVisitId || right.id)))
    .map((lead, index) => ({ ...lead, routeOrder: index + 1 }));
}

function sameVisitMembership(route: CanonicalRouteLead[], snapshot: any) {
  if (!snapshot) return false;
  const routeIds = route
    .map(lead => String(lead.canonicalVisitId || lead.id || ""))
    .filter(Boolean)
    .sort();
  const snapshotIds = (snapshot.stops || [])
    .map((stop: any) => String(stop.visitId || ""))
    .filter(Boolean)
    .sort();
  return routeIds.length === snapshotIds.length
    && routeIds.every((id, index) => id === snapshotIds[index]);
}

function routeFromSnapshot(snapshot: any): CanonicalRouteLead[] {
  return (snapshot?.stops || []).map((stop: any) => ({
    id: stop.visitId,
    createdAt: stop.scheduledDate ? `${stop.scheduledDate}T12:00:00.000Z` : "1970-01-01T00:00:00.000Z",
    name: stop.customerName,
    phone: "",
    email: "",
    address: stop.address,
    service: stop.serviceName,
    status: stop.status === "completed" ? "completed" as const : "booked" as const,
    subtotal: 0,
    tax: 0,
    total: 0,
    photos: [],
    scheduledDate: stop.scheduledDate,
    routeOrder: stop.routeOrder,
    latitude: stop.latitude ?? undefined,
    longitude: stop.longitude ?? undefined,
    canonicalVisitId: stop.visitId,
    canonicalJobId: stop.jobId || undefined,
    canonicalRouteId: snapshot.routeId,
    canonicalCustomerId: stop.customerId || undefined,
    canonicalPropertyId: stop.propertyId || undefined,
    canonicalEmployeeId: stop.employeeId || undefined,
    canonicalCrewId: stop.crewId || undefined,
    canonicalVisitStatus: stop.status as CanonicalRouteLead["canonicalVisitStatus"],
    visitStartedAt: stop.startedAt || undefined,
    visitFinishedAt: stop.finishedAt || undefined,
    visitDurationSeconds: stop.durationSeconds ?? undefined,
  }));
}

function enrichCurrentMembership(route: CanonicalRouteLead[], snapshot: any) {
  if (!snapshot?.stops?.length) return route;
  const snapshotByVisit = new Map<string, any>(
    snapshot.stops.map((stop: any) => [String(stop.visitId), stop]),
  );
  return route.map(lead => {
    const visitId = String(lead.canonicalVisitId || lead.id || "");
    const stop = snapshotByVisit.get(visitId);
    if (!stop) return lead;
    return {
      ...lead,
      latitude: Number.isFinite(stop.latitude) ? Number(stop.latitude) : lead.latitude,
      longitude: Number.isFinite(stop.longitude) ? Number(stop.longitude) : lead.longitude,
      canonicalCustomerId: lead.canonicalCustomerId || stop.customerId || undefined,
      canonicalPropertyId: lead.canonicalPropertyId || stop.propertyId || undefined,
      canonicalJobId: lead.canonicalJobId || stop.jobId || undefined,
    };
  });
}

function routeKey(lead: CanonicalRouteLead) {
  return String(lead.canonicalVisitId || lead.id);
}

async function geocodeAddress(address: string): Promise<Coordinates | null> {
  const value = address.trim();
  if (!value) return null;
  try {
    const response = await fetch(`/api/map/geocode?address=${encodeURIComponent(value)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const point = await response.json() as Partial<Coordinates>;
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
    return { latitude: Number(point.latitude), longitude: Number(point.longitude) };
  } catch {
    return null;
  }
}

export function EmployeeRouteMap({
  route,
  onOpenVisit,
  routeId,
  desktop = false,
  actionLabel = "Open Visit",
  originPoint = null,
  preview = false,
}: Props) {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const locationLayerRef = useRef<any>(null);
  const didInitialFit = useRef(false);
  const [selectedId, setSelectedId] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [resolvedCoordinates, setResolvedCoordinates] = useState<Record<string, Coordinates>>({});

  const operationalRoute = useMemo(() => normalizeRoute(route), [route]);
  const effectiveRouteId = preview
    ? null
    : routeId || operationalRoute.find(lead => Boolean(lead.canonicalRouteId))?.canonicalRouteId || null;
  const { snapshot, error, loading, refresh } = useCanonicalRouteSnapshot(effectiveRouteId);
  const snapshotMatches = !preview
    && Boolean(snapshot)
    && snapshot?.routeId === effectiveRouteId
    && sameVisitMembership(operationalRoute, snapshot);

  const displayRoute = useMemo<CanonicalRouteLead[]>(() => {
    if (preview) return operationalRoute;
    if (snapshotMatches) return normalizeRoute(routeFromSnapshot(snapshot));
    return normalizeRoute(enrichCurrentMembership(operationalRoute, snapshot));
  }, [preview, operationalRoute, snapshot, snapshotMatches]);

  useEffect(() => {
    let cancelled = false;
    const missing = displayRoute.filter(lead =>
      (!Number.isFinite(lead.latitude) || !Number.isFinite(lead.longitude))
      && !resolvedCoordinates[routeKey(lead)]
      && Boolean(lead.address?.trim()));
    if (!missing.length) return () => { cancelled = true; };

    void Promise.all(missing.map(async lead => ({
      id: routeKey(lead),
      point: await geocodeAddress(lead.address),
    }))).then(results => {
      if (cancelled) return;
      const successful = results.filter((item): item is { id: string; point: Coordinates } => Boolean(item.point));
      if (!successful.length) return;
      setResolvedCoordinates(current => {
        const next = { ...current };
        successful.forEach(item => { next[item.id] = item.point; });
        return next;
      });
    });

    return () => { cancelled = true; };
  }, [displayRoute, resolvedCoordinates]);

  const mappedRoute = useMemo(() => displayRoute.map(lead => {
    const fallback = resolvedCoordinates[routeKey(lead)];
    if (!fallback) return lead;
    return {
      ...lead,
      latitude: Number.isFinite(lead.latitude) ? lead.latitude : fallback.latitude,
      longitude: Number.isFinite(lead.longitude) ? lead.longitude : fallback.longitude,
    };
  }), [displayRoute, resolvedCoordinates]);

  const points = useMemo<Point[]>(() => mappedRoute.flatMap(lead => {
    if (!Number.isFinite(lead.latitude) || !Number.isFinite(lead.longitude)) return [];
    return [{
      ...lead,
      latitude: Number(lead.latitude),
      longitude: Number(lead.longitude),
      ...visualState(lead),
    }];
  }), [mappedRoute]);

  const origin = preview ? originPoint : snapshot?.origin || originPoint || null;
  const unmapped = mappedRoute.filter(lead => !points.some(point => routeKey(point) === routeKey(lead)));
  const selected = points.find(point => routeKey(point) === selectedId) || points[0] || null;

  useEffect(() => {
    didInitialFit.current = false;
    setSelectedId("");
    setResolvedCoordinates({});
  }, [effectiveRouteId, snapshotMatches ? snapshot?.routeVersion : operationalRoute.length]);

  function fitRoute() {
    if (!mapRef.current || !window.L || (!points.length && !origin)) return;
    const bounds = [
      ...points.map(point => [point.latitude, point.longitude] as [number, number]),
      ...(origin ? [[origin.latitude, origin.longitude] as [number, number]] : []),
    ];
    mapRef.current.fitBounds(window.L.latLngBounds(bounds).pad(.16), { maxZoom: 16 });
  }

  function recenterMe() {
    if (!mapRef.current || !window.L) return;
    setLocationMessage("Locating…");
    navigator.geolocation?.getCurrentPosition(position => {
      if (locationLayerRef.current) mapRef.current.removeLayer(locationLayerRef.current);
      const location: [number, number] = [position.coords.latitude, position.coords.longitude];
      locationLayerRef.current = window.L.circleMarker(location, {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: "#2563eb",
        fillOpacity: 1,
      }).addTo(mapRef.current);
      mapRef.current.setView(location, Math.max(mapRef.current.getZoom(), 15));
      setLocationMessage("");
    }, () => setLocationMessage("Location unavailable"), {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 60_000,
    });
  }

  useEffect(() => {
    let cancelled = false;
    const setup = () => {
      if (cancelled || !mapNode.current || !window.L) return;
      const L = window.L;
      if (!mapRef.current) {
        mapRef.current = L.map(mapNode.current, {
          zoomControl: true,
          attributionControl: true,
        }).setView(HAMILTON, 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap contributors",
        }).addTo(mapRef.current);
        markerLayerRef.current = L.layerGroup().addTo(mapRef.current);
        setMapReady(true);
      }
      window.setTimeout(() => mapRef.current?.invalidateSize(), 50);
    };

    if (window.L) setup();
    else {
      if (!document.querySelector("link[data-leaflet]")) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.dataset.leaflet = "true";
        document.head.appendChild(link);
      }
      let script = document.querySelector("script[data-leaflet]") as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.async = true;
        script.dataset.leaflet = "true";
        document.body.appendChild(script);
      }
      script.addEventListener("load", setup);
      return () => {
        cancelled = true;
        script?.removeEventListener("load", setup);
      };
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.L || !markerLayerRef.current) return;
    const L = window.L;
    markerLayerRef.current.clearLayers();

    if (origin) {
      const originIcon = L.divIcon({
        className: "employee-map-marker-shell",
        html: "<div class=\"employee-map-origin-marker\">●</div>",
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });
      L.marker([origin.latitude, origin.longitude], { icon: originIcon })
        .bindTooltip(origin.label || "Route start", { direction: "top" })
        .addTo(markerLayerRef.current);
    }

    points.forEach(point => {
      const id = routeKey(point);
      const active = selected && routeKey(selected) === id;
      const icon = L.divIcon({
        className: "employee-map-marker-shell",
        html: `<div class="employee-map-marker ${active ? "active" : ""}" style="background:${point.color}">${point.routeOrder}</div>`,
        iconSize: [active ? 40 : 34, active ? 40 : 34],
        iconAnchor: [active ? 20 : 17, active ? 20 : 17],
      });
      L.marker([point.latitude, point.longitude], { icon })
        .bindTooltip(`${point.name} · ${point.label}`, { direction: "top" })
        .on("click", () => setSelectedId(id))
        .addTo(markerLayerRef.current);
    });

    if (!didInitialFit.current && (points.length || origin)) {
      didInitialFit.current = true;
      fitRoute();
    }
    window.setTimeout(() => mapRef.current?.invalidateSize(), 50);
  }, [mapReady, points, selected, origin?.latitude, origin?.longitude, origin?.label]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.L) return;
    if (routeLayerRef.current) {
      mapRef.current.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }
    if (preview) return;

    const canonicalCoordinates = snapshotMatches && snapshot?.geometry?.coordinates?.length
      ? snapshot.geometry.coordinates.map(([longitude, latitude]: [number, number]) => [latitude, longitude])
      : null;
    const currentCoordinates = [
      ...(origin ? [[origin.latitude, origin.longitude] as [number, number]] : []),
      ...points.map(point => [point.latitude, point.longitude] as [number, number]),
    ];
    const coordinates = canonicalCoordinates || (currentCoordinates.length >= 2 ? currentCoordinates : null);
    if (!coordinates) return;

    routeLayerRef.current = window.L.polyline(
      coordinates,
      { color: "#2563eb", weight: 5, opacity: .82, lineJoin: "round" },
    ).addTo(mapRef.current);
    routeLayerRef.current.bringToBack();
  }, [mapReady, preview, snapshotMatches, snapshot?.routeVersion, snapshot?.geometry, points, origin?.latitude, origin?.longitude]);

  const mapStatus = preview
    ? "Smart Route preview · not published"
    : snapshotMatches
      ? `Canonical route v${snapshot?.routeVersion}`
      : points.length === mappedRoute.length && mappedRoute.length > 0
        ? "Current route · geometry rebuilt from active stops"
        : loading
          ? "Loading map snapshot…"
          : error
            ? "Current route loaded · some coordinates unavailable"
            : "Current canonical route · geometry refreshing";

  return <section className={`employee-map-panel ${desktop ? "employee-map-desktop" : ""}`}>
    <div className="employee-map-toolbar">
      <div>
        <strong>{points.length}/{mappedRoute.length} properties mapped</strong>
        <span>{mapStatus}{locationMessage ? ` · ${locationMessage}` : ""}</span>
      </div>
      <div className="employee-map-toolbar-actions">
        <button type="button" onClick={fitRoute} disabled={!points.length && !origin}>Fit Route</button>
        <button type="button" onClick={recenterMe}>Recenter Me</button>
        {error && !preview && <button type="button" onClick={() => void refresh()}>Retry</button>}
      </div>
    </div>
    {unmapped.length > 0 && <p className="employee-map-notice">
      Mapping {unmapped.length} remaining {unmapped.length === 1 ? "property" : "properties"}…
    </p>}
    <div ref={mapNode} className="employee-route-map" aria-label="Interactive map of assigned visits" />

    {desktop && <aside className="employee-canonical-route-list" aria-label="Canonical route stops">
      <header>
        <div>
          <strong>Official route</strong>
          <small>{mappedRoute.length} stops · one canonical membership</small>
        </div>
        <b>{snapshotMatches ? `v${snapshot?.routeVersion}` : "LIVE"}</b>
      </header>
      <div className="employee-canonical-route-scroll">
        {mappedRoute.map(lead => {
          const id = routeKey(lead);
          return <button
            type="button"
            key={id}
            className={selected && routeKey(selected) === id ? "active" : ""}
            onClick={() => {
              setSelectedId(id);
              onOpenVisit(lead);
            }}
          >
            <b>{lead.routeOrder}</b>
            <span><strong>{lead.name}</strong><small>{lead.address}</small></span>
            <em>{statusLabel(lead)}</em>
          </button>;
        })}
      </div>
    </aside>}

    {selected && <article className="employee-map-sheet">
      <div className="employee-map-sheet-main">
        <span className="employee-map-sequence" style={{ background: selected.color }}>{selected.routeOrder}</span>
        <div><strong>{selected.address}</strong><span>{selected.name} · {selected.service}</span></div>
        <b style={{ color: selected.color }}>{selected.label}</b>
      </div>
      <div className="employee-map-sheet-actions">
        <button type="button" onClick={() => onOpenVisit(selected)}>{actionLabel}</button>
        <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selected.address)}&travelmode=driving`} target="_blank" rel="noreferrer">Directions</a>
      </div>
    </article>}

    {desktop && <style jsx global>{`
      .employee-web-map-shell:has(.employee-map-desktop){grid-template-columns:1fr!important}
      .employee-web-map-shell:has(.employee-map-desktop)>.employee-web-map-sidebar{display:none!important}
      .official-route-focused:has(.employee-map-desktop){grid-template-columns:1fr!important}
      .official-route-focused:has(.employee-map-desktop)>.official-house-list{display:none!important}
      .employee-map-desktop{position:relative;min-width:0}
      .employee-map-desktop .employee-route-map{min-height:620px}
      .employee-canonical-route-list{position:absolute;z-index:750;top:108px;right:18px;width:min(300px,38%);height:360px;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;border:1px solid rgba(214,226,220,.95);border-radius:18px;background:rgba(255,255,255,.97);box-shadow:0 18px 45px rgba(20,54,40,.18);backdrop-filter:blur(10px)}
      .employee-canonical-route-list>header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;border-bottom:1px solid #e4ece8}.employee-canonical-route-list>header div{display:grid;gap:2px}.employee-canonical-route-list>header strong{font-size:16px;color:#173d2d}.employee-canonical-route-list>header small{font-size:10px;color:#687a71}.employee-canonical-route-list>header>b{padding:4px 7px;border-radius:999px;background:#e7f6ed;color:#087247;font-size:9px}
      .employee-canonical-route-scroll{overflow:auto;padding:6px}.employee-canonical-route-scroll>button{width:100%;display:grid;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 7px;border:1px solid transparent;border-radius:12px;background:transparent;text-align:left;cursor:pointer}.employee-canonical-route-scroll>button:hover,.employee-canonical-route-scroll>button.active{border-color:#b8ddc9;background:#eff9f3}.employee-canonical-route-scroll>button>b{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#0c7449;color:#fff}.employee-canonical-route-scroll>button span{min-width:0;display:grid;gap:1px}.employee-canonical-route-scroll>button span strong,.employee-canonical-route-scroll>button span small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.employee-canonical-route-scroll>button span strong{font-size:12px;color:#173d2d}.employee-canonical-route-scroll>button span small{font-size:9px;color:#66766f}.employee-canonical-route-scroll>button em{font-style:normal;font-size:8px;font-weight:800;color:#607169}
      @media(max-width:900px){.employee-canonical-route-list{top:104px;width:278px;max-width:44%;height:340px}.employee-map-desktop .employee-route-map{min-height:560px}}
    `}</style>}
  </section>;
}