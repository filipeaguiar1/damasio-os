"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSessionForLead } from "@/lib/storage";
import type { CanonicalRouteLead } from "@/lib/routes/canonicalRouteIdentity";
import type { RouteLineString } from "@/lib/maps/types";
import { readRoadGeometry, saveRoadGeometry } from "@/lib/maps/clientMapCache";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

declare global { interface Window { L?: any } }

type Point = CanonicalRouteLead & { latitude: number; longitude: number; color: string; label: string };
type RouteOriginPoint = { latitude: number; longitude: number; label?: string };
type Props = {
  route: CanonicalRouteLead[];
  onOpenVisit: (lead: CanonicalRouteLead) => void;
  routeId?: string;
  desktop?: boolean;
  actionLabel?: string;
  originPoint?: RouteOriginPoint | null;
};

type CanonicalMapStop = {
  visitId: string;
  jobId?: string | null;
  routeId?: string | null;
  customerId?: string | null;
  propertyId?: string | null;
  employeeId?: string | null;
  crewId?: string | null;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  routeOrder: number;
  status: string;
  customerName?: string;
  serviceName?: string;
  scheduledDate?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationSeconds?: number | null;
};

type CanonicalMapSnapshot = {
  routeId: string;
  routeDate?: string;
  version: number;
  activeSmartRoute: boolean;
  origin?: {
    latitude?: number | null;
    longitude?: number | null;
    label?: string;
    address?: string | null;
  } | null;
  stops: CanonicalMapStop[];
};

const HAMILTON: [number, number] = [43.2557, -79.8711];

function visualState(lead: CanonicalRouteLead, _isNext: boolean) {
  const canonicalStatus = lead.canonicalVisitStatus;
  if (canonicalStatus === "completed" || lead.status === "completed") return { color: "#16a34a", label: "Completed" };
  if (canonicalStatus === "missed") return { color: "#eab308", label: "Skipped" };

  const session = getSessionForLead(lead.id);
  if (session?.status === "skipped") return { color: "#eab308", label: "Skipped" };
  if (session?.status === "finished") return { color: "#16a34a", label: "Completed" };
  return { color: "#64748b", label: "Pending" };
}

export function EmployeeRouteMap({
  route,
  onOpenVisit,
  routeId,
  desktop = false,
  actionLabel = "Open Visit",
  originPoint = null,
}: Props) {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const locationLayerRef = useRef<any>(null);
  const didInitialFit = useRef(false);
  const snapshotSignatureRef = useRef("");
  const [selectedId, setSelectedId] = useState("");
  const [geometry, setGeometry] = useState<RouteLineString | null>(null);
  const [resolvedRoute, setResolvedRoute] = useState<CanonicalRouteLead[]>(route);
  const [snapshot, setSnapshot] = useState<CanonicalMapSnapshot | null>(null);
  const [snapshotOrigin, setSnapshotOrigin] = useState<RouteOriginPoint | null>(null);
  const [mapStatus, setMapStatus] = useState("Locating properties...");
  const [mapReady, setMapReady] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const effectiveRouteId = routeId
    || route.find(lead => Boolean(lead.canonicalRouteId))?.canonicalRouteId;

  useEffect(() => {
    let cancelled = false;
    snapshotSignatureRef.current = "";
    setSnapshot(null);
    if (!effectiveRouteId) return () => { cancelled = true; };

    async function loadSnapshot() {
      try {
        const client = getSupabaseBrowserClient() as any;
        const { data } = await client.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) return;

        const response = await fetch(`/api/map/canonical-route?routeId=${encodeURIComponent(effectiveRouteId!)}`, {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (!response.ok) return;
        const result = await response.json() as CanonicalMapSnapshot;
        const signature = JSON.stringify({
          version: result.version,
          activeSmartRoute: result.activeSmartRoute,
          origin: result.origin,
          stops: result.stops.map(stop => [
            stop.visitId,
            stop.routeOrder,
            stop.status,
            stop.address,
            stop.latitude,
            stop.longitude,
          ]),
        });
        if (!cancelled && signature !== snapshotSignatureRef.current) {
          snapshotSignatureRef.current = signature;
          setSnapshot(result);
        }
      } catch {
        // The supplied route remains available while synchronization retries.
      }
    }

    const refreshVisible = () => {
      if (document.visibilityState === "visible") void loadSnapshot();
    };
    void loadSnapshot();
    const timer = window.setInterval(() => void loadSnapshot(), 5_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [effectiveRouteId]);

  const displayRoute = useMemo<CanonicalRouteLead[]>(() => {
    if (!snapshot) return route;

    const byVisitId = new Map(route.map(lead => [lead.canonicalVisitId || lead.id, lead]));
    const byJobId = new Map(route
      .filter(lead => Boolean(lead.canonicalJobId))
      .map(lead => [lead.canonicalJobId as string, lead]));

    return snapshot.stops.map(stop => {
      const existing = byVisitId.get(stop.visitId)
        || (stop.jobId ? byJobId.get(stop.jobId) : undefined);
      return {
        ...(existing || {
          id: stop.visitId,
          createdAt: stop.scheduledDate ? `${stop.scheduledDate}T12:00:00.000Z` : "1970-01-01T00:00:00.000Z",
          name: stop.customerName || "Customer",
          phone: "",
          email: "",
          address: stop.address,
          service: stop.serviceName || "Property Service",
          status: "booked" as const,
          subtotal: 0,
          tax: 0,
          total: 0,
          photos: [],
        }),
        id: stop.visitId,
        name: stop.customerName || existing?.name || "Customer",
        address: stop.address || existing?.address || "",
        service: stop.serviceName || existing?.service || "Property Service",
        scheduledDate: stop.scheduledDate || existing?.scheduledDate,
        routeOrder: stop.routeOrder,
        latitude: Number.isFinite(stop.latitude) ? Number(stop.latitude) : undefined,
        longitude: Number.isFinite(stop.longitude) ? Number(stop.longitude) : undefined,
        canonicalVisitId: stop.visitId,
        canonicalJobId: stop.jobId || existing?.canonicalJobId,
        canonicalRouteId: stop.routeId || snapshot.routeId,
        canonicalCustomerId: stop.customerId || existing?.canonicalCustomerId,
        canonicalPropertyId: stop.propertyId || existing?.canonicalPropertyId,
        canonicalEmployeeId: stop.employeeId || existing?.canonicalEmployeeId,
        canonicalCrewId: stop.crewId || existing?.canonicalCrewId,
        canonicalVisitStatus: stop.status as CanonicalRouteLead["canonicalVisitStatus"],
        visitStartedAt: stop.startedAt || undefined,
        visitFinishedAt: stop.finishedAt || undefined,
        visitDurationSeconds: stop.durationSeconds ?? undefined,
        status: stop.status === "completed" ? "completed" as const : "booked" as const,
      };
    });
  }, [route, snapshot]);

  useEffect(() => {
    let cancelled = false;
    const origin = snapshot?.origin;
    setSnapshotOrigin(null);
    if (!origin) return () => { cancelled = true; };

    if (Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude)) {
      setSnapshotOrigin({
        latitude: Number(origin.latitude),
        longitude: Number(origin.longitude),
        label: origin.label || "Route start",
      });
      return () => { cancelled = true; };
    }

    const address = origin.address?.trim();
    if (!address) return () => { cancelled = true; };
    void fetch(`/api/map/geocode?address=${encodeURIComponent(address)}`, { cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error("Route start could not be mapped.");
        return response.json() as Promise<{ latitude: number; longitude: number }>;
      })
      .then(point => {
        if (cancelled || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;
        setSnapshotOrigin({
          latitude: Number(point.latitude),
          longitude: Number(point.longitude),
          label: origin.label || "Route start",
        });
      })
      .catch(() => {
        if (!cancelled) setSnapshotOrigin(null);
      });

    return () => { cancelled = true; };
  }, [snapshot?.version, snapshot?.activeSmartRoute, snapshot?.origin?.latitude, snapshot?.origin?.longitude, snapshot?.origin?.address, snapshot?.origin?.label]);

  const effectiveOrigin = snapshotOrigin || originPoint;
  const originKey = effectiveOrigin ? `${effectiveOrigin.latitude}:${effectiveOrigin.longitude}` : "";
  const routeKey = `${snapshot?.version || 0}|${displayRoute.map(lead =>
    `${lead.id}:${lead.address}:${lead.latitude ?? ""}:${lead.longitude ?? ""}:${lead.routeOrder ?? ""}:${lead.canonicalVisitStatus || lead.status}`
  ).join("|")}`;

  useEffect(() => {
    let cancelled = false;
    didInitialFit.current = false;
    setSelectedId("");
    setGeometry(null);

    async function locateAndRoute() {
      const alreadyLocated = displayRoute.filter(lead => Number.isFinite(lead.latitude) && Number.isFinite(lead.longitude));
      setResolvedRoute(alreadyLocated);
      setMapStatus(alreadyLocated.length === displayRoute.length
        ? "Map ready"
        : "Locating new properties...");

      const located = await Promise.all(displayRoute.map(async lead => {
        if (Number.isFinite(lead.latitude) && Number.isFinite(lead.longitude)) return lead;
        try {
          const response = await fetch(`/api/map/geocode?address=${encodeURIComponent(lead.address)}`, { cache: "no-store" });
          if (!response.ok) throw new Error("Address not found");
          const position = await response.json() as { latitude: number; longitude: number };
          return { ...lead, ...position };
        } catch {
          return null;
        }
      })).then(values => values.filter((lead): lead is CanonicalRouteLead => Boolean(lead)));

      if (cancelled) return;
      setResolvedRoute(located);

      const coordinates = [
        ...(effectiveOrigin
          ? [[Number(effectiveOrigin.longitude), Number(effectiveOrigin.latitude)] as [number, number]]
          : []),
        ...located.map(lead => [Number(lead.longitude), Number(lead.latitude)] as [number, number]),
      ];

      if (coordinates.length < 2) {
        setGeometry(null);
        setMapStatus("Map ready");
        return;
      }

      const cached = readRoadGeometry(coordinates);
      if (cached) {
        setGeometry(cached);
        setMapStatus("Driving route");
        return;
      }

      setMapStatus("Calculating driving route...");
      try {
        const response = await fetch("/api/map/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coordinates }),
        });
        if (!response.ok) throw new Error("Route unavailable");
        const result = await response.json() as { geometry: RouteLineString };
        if (!cancelled) {
          saveRoadGeometry(coordinates, result.geometry);
          setGeometry(result.geometry);
          setMapStatus("Driving route");
        }
      } catch {
        if (!cancelled) setMapStatus("Properties mapped - route unavailable");
      }
    }

    void locateAndRoute();
    return () => { cancelled = true; };
  }, [routeKey, originKey]);

  const nextVisitId = useMemo(() => resolvedRoute.find(lead => {
    if (lead.canonicalVisitId) return lead.status !== "completed";
    const session = getSessionForLead(lead.id);
    return lead.status !== "completed" && session?.status !== "finished" && session?.status !== "skipped";
  })?.id, [resolvedRoute]);

  const points = useMemo<Point[]>(() => resolvedRoute.flatMap(lead => {
    if (!Number.isFinite(lead.latitude) || !Number.isFinite(lead.longitude)) return [];
    return [{
      ...lead,
      latitude: Number(lead.latitude),
      longitude: Number(lead.longitude),
      ...visualState(lead, lead.id === nextVisitId),
    }];
  }), [resolvedRoute, nextVisitId]);

  const unmapped = displayRoute.filter(lead => !points.some(point => point.id === lead.id));
  const selected = points.find(point => point.id === selectedId) || points[0] || null;

  function fitRoute() {
    if (!mapRef.current || !window.L || (!points.length && !effectiveOrigin)) return;
    const bounds = [
      ...points.map(point => [point.latitude, point.longitude] as [number, number]),
      ...(effectiveOrigin ? [[effectiveOrigin.latitude, effectiveOrigin.longitude] as [number, number]] : []),
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
        mapRef.current = L.map(mapNode.current, { zoomControl: true, attributionControl: true }).setView(HAMILTON, 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap contributors",
        }).addTo(mapRef.current);
        markerLayerRef.current = L.layerGroup().addTo(mapRef.current);
        setMapReady(true);
      }

      markerLayerRef.current.clearLayers();
      if (effectiveOrigin) {
        const originIcon = L.divIcon({
          className: "employee-map-marker-shell",
          html: `<div class="employee-map-origin-marker">S</div>`,
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        });
        L.marker([effectiveOrigin.latitude, effectiveOrigin.longitude], { icon: originIcon, zIndexOffset: 20_000 })
          .bindTooltip(effectiveOrigin.label || "Route start", { direction: "top" })
          .addTo(markerLayerRef.current);
      }

      points.forEach((point, index) => {
        const active = selected?.id === point.id;
        const sequence = point.routeOrder || index + 1;
        const icon = L.divIcon({
          className: "employee-map-marker-shell",
          html: `<div class="employee-map-marker ${active ? "active" : ""}" style="background:${point.color}">${sequence}</div>`,
          iconSize: [active ? 40 : 34, active ? 40 : 34],
          iconAnchor: [active ? 20 : 17, active ? 20 : 17],
        });
        L.marker([point.latitude, point.longitude], {
          icon,
          zIndexOffset: 10_000 - Number(sequence),
        })
          .bindTooltip(`Stop ${sequence} · ${point.name} · ${point.label}`, { direction: "top" })
          .on("click", () => setSelectedId(point.id))
          .addTo(markerLayerRef.current);
      });

      if (!didInitialFit.current && (points.length || effectiveOrigin)) {
        didInitialFit.current = true;
        fitRoute();
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
  }, [points, selected?.id, originKey]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.L) return;
    if (routeLayerRef.current) {
      mapRef.current.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }
    if (!geometry?.coordinates?.length) return;

    routeLayerRef.current = window.L.polyline(
      geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]),
      { color: "#2563eb", weight: 5, opacity: .82, lineJoin: "round" },
    ).addTo(mapRef.current);
    routeLayerRef.current.bringToBack();
  }, [geometry, mapReady]);

  return <section className={`employee-map-panel ${desktop ? "employee-map-desktop" : ""}`}>
    <div className="employee-map-toolbar">
      <div><strong>{points.length}/{displayRoute.length} properties mapped</strong><span>{mapStatus}{locationMessage ? ` · ${locationMessage}` : ""}</span></div>
      <div className="employee-map-toolbar-actions"><button type="button" onClick={fitRoute} disabled={!points.length && !effectiveOrigin}>Fit Route</button><button type="button" onClick={recenterMe}>Recenter Me</button></div>
    </div>
    {unmapped.length > 0 && <p className="employee-map-notice">{unmapped.length} {unmapped.length === 1 ? "property is" : "properties are"} Not mapped.</p>}
    <div ref={mapNode} className="employee-route-map" aria-label="Interactive map of assigned visits" />
    {selected && <article className="employee-map-sheet">
      <div className="employee-map-sheet-main">
        <span className="employee-map-sequence" style={{ background: selected.color }}>{selected.routeOrder || points.findIndex(point => point.id === selected.id) + 1}</span>
        <div><strong>{selected.address}</strong><span>{selected.name} · {selected.service}</span></div>
        <b style={{ color: selected.color }}>{selected.label}</b>
      </div>
      <div className="employee-map-sheet-actions"><button type="button" onClick={() => onOpenVisit(selected)}>{actionLabel}</button><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selected.address)}&travelmode=driving`} target="_blank" rel="noreferrer">Directions</a></div>
    </article>}
  </section>;
}
