"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Lead } from "@/lib/storage";
import { getEmployeeTasks, getSessionForLead, updateLead } from "@/lib/storage";
import { loadCachedRouteGeometry } from "@/lib/services/routeMapService";
import type { RouteLineString } from "@/lib/maps/types";
import { readRoadGeometry, saveRoadGeometry } from "@/lib/maps/clientMapCache";

declare global { interface Window { L?: any } }

type Point = Lead & { latitude: number; longitude: number; color: string; label: string };

type Props = {
  route: Lead[];
  onOpenVisit: (lead: Lead) => void;
  routeId?: string;
  desktop?: boolean;
};

const HAMILTON: [number, number] = [43.2557, -79.8711];

function visualState(lead: Lead, isNext: boolean) {
  const session = getSessionForLead(lead.id);
  const needsAttention = getEmployeeTasks().some(task => task.leadId === lead.id && task.status !== "resolved");
  if (needsAttention) return { color: "#dc2626", label: "Needs attention" };
  if (session?.status === "skipped") return { color: "#eab308", label: "Skipped" };
  if (lead.status === "completed" || session?.status === "finished") return { color: "#16a34a", label: "Completed" };
  if (isNext) return { color: "#2563eb", label: "Next visit" };
  return { color: "#64748b", label: "Pending" };
}

export function EmployeeRouteMap({ route, onOpenVisit, routeId, desktop = false }: Props) {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const locationLayerRef = useRef<any>(null);
  const didInitialFit = useRef(false);
  const [selectedId, setSelectedId] = useState("");
  const [geometry, setGeometry] = useState<RouteLineString | null>(null);
  const [resolvedRoute, setResolvedRoute] = useState<Lead[]>(route);
  const [mapStatus, setMapStatus] = useState("Locating properties...");
  const [mapReady, setMapReady] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const routeKey = route.map(lead => `${lead.id}:${lead.address}`).join("|");

  useEffect(() => {
    let cancelled = false;
    async function locateAndRoute() {
      const alreadyLocated = route.filter(lead => Number.isFinite(lead.latitude) && Number.isFinite(lead.longitude));
      setResolvedRoute(alreadyLocated);
      setMapStatus(alreadyLocated.length === route.length ? "Map ready" : "Locating new properties...");
      const located = await Promise.all(route.map(async lead => {
        if (Number.isFinite(lead.latitude) && Number.isFinite(lead.longitude)) return lead;
        try {
          const response = await fetch(`/api/map/geocode?address=${encodeURIComponent(lead.address)}`, { cache: "no-store" });
          if (!response.ok) throw new Error("Address not found");
          const position = await response.json() as { latitude: number; longitude: number };
          const mapped = { ...lead, ...position };
          updateLead(lead.id, position);
          return mapped;
        } catch {
          return null;
        }
      })).then(values => values.filter((lead): lead is Lead => Boolean(lead)));
      if (cancelled) return;
      setResolvedRoute(located);
      if (located.length < 2) { setGeometry(null); setMapStatus("Map ready"); return; }
      const coordinates = located.map(lead => [Number(lead.longitude), Number(lead.latitude)] as [number, number]);
      const cached = readRoadGeometry(coordinates);
      if (cached) { setGeometry(cached); setMapStatus("Driving route"); return; }
      setMapStatus("Calculating driving route...");
      try {
        const response = await fetch("/api/map/route", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coordinates })
        });
        if (!response.ok) throw new Error("Route unavailable");
        const result = await response.json() as { geometry: RouteLineString };
        if (!cancelled) { saveRoadGeometry(coordinates, result.geometry); setGeometry(result.geometry); setMapStatus("Driving route"); }
      } catch { if (!cancelled) setMapStatus("Properties mapped - route unavailable"); }
    }
    locateAndRoute();
    return () => { cancelled = true; };
  }, [routeKey]); // Re-geocode only when the assigned stops or their addresses change.

  useEffect(() => {
    let cancelled = false;
    setGeometry(null);
    if (!routeId) return () => { cancelled = true; };
    loadCachedRouteGeometry(routeId)
      .then(cache => { if (!cancelled) setGeometry(cache?.status === "ready" ? cache.geometry : null); })
      .catch(() => { if (!cancelled) setGeometry(null); });
    return () => { cancelled = true; };
  }, [routeId]);

  const nextVisitId = useMemo(() => resolvedRoute.find(lead => {
    const session = getSessionForLead(lead.id);
    return lead.status !== "completed" && session?.status !== "finished" && session?.status !== "skipped";
  })?.id, [resolvedRoute]);

  const points = useMemo<Point[]>(() => resolvedRoute.flatMap(lead => {
    if (!Number.isFinite(lead.latitude) || !Number.isFinite(lead.longitude)) return [];
    return [{ ...lead, latitude: Number(lead.latitude), longitude: Number(lead.longitude), ...visualState(lead, lead.id === nextVisitId) }];
  }), [resolvedRoute, nextVisitId]);
  const unmapped = route.filter(lead => !points.some(point => point.id === lead.id));
  const selected = points.find(point => point.id === selectedId) || points[0] || null;

  function fitRoute() {
    if (!mapRef.current || !window.L || !points.length) return;
    mapRef.current.fitBounds(window.L.latLngBounds(points.map(point => [point.latitude, point.longitude])).pad(.16), { maxZoom: 16 });
  }

  function recenterMe() {
    if (!mapRef.current || !window.L) return;
    setLocationMessage("Locating…");
    navigator.geolocation?.getCurrentPosition(position => {
      if (locationLayerRef.current) mapRef.current.removeLayer(locationLayerRef.current);
      const location: [number, number] = [position.coords.latitude, position.coords.longitude];
      locationLayerRef.current = window.L.circleMarker(location, {
        radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1
      }).addTo(mapRef.current);
      mapRef.current.setView(location, Math.max(mapRef.current.getZoom(), 15));
      setLocationMessage("");
    }, () => setLocationMessage("Location unavailable"), { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 });
  }

  useEffect(() => {
    let cancelled = false;
    const setup = () => {
      if (cancelled || !mapNode.current || !window.L) return;
      const L = window.L;
      if (!mapRef.current) {
        mapRef.current = L.map(mapNode.current, { zoomControl: true, attributionControl: true }).setView(HAMILTON, 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(mapRef.current);
        markerLayerRef.current = L.layerGroup().addTo(mapRef.current);
        setMapReady(true);
      }
      markerLayerRef.current.clearLayers();
      points.forEach((point, index) => {
        const active = selected?.id === point.id;
        const icon = L.divIcon({
          className: "employee-map-marker-shell",
          html: `<div class="employee-map-marker ${active ? "active" : ""}" style="background:${point.color}">${index + 1}</div>`,
          iconSize: [active ? 40 : 34, active ? 40 : 34], iconAnchor: [active ? 20 : 17, active ? 20 : 17]
        });
        L.marker([point.latitude, point.longitude], { icon }).on("click", () => setSelectedId(point.id)).addTo(markerLayerRef.current);
      });
      if (!didInitialFit.current && points.length) {
        didInitialFit.current = true;
        fitRoute();
      }
      window.setTimeout(() => mapRef.current?.invalidateSize(), 50);
    };
    if (window.L) setup();
    else {
      if (!document.querySelector("link[data-leaflet]")) {
        const link = document.createElement("link");
        link.rel = "stylesheet"; link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; link.dataset.leaflet = "true";
        document.head.appendChild(link);
      }
      let script = document.querySelector("script[data-leaflet]") as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script"); script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; script.async = true; script.dataset.leaflet = "true";
        document.body.appendChild(script);
      }
      script.addEventListener("load", setup);
      return () => { cancelled = true; script?.removeEventListener("load", setup); };
    }
    return () => { cancelled = true; };
  }, [points, selected?.id]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.L) return;
    if (routeLayerRef.current) { mapRef.current.removeLayer(routeLayerRef.current); routeLayerRef.current = null; }
    if (!geometry?.coordinates?.length) return;
    routeLayerRef.current = window.L.polyline(
      geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]),
      { color: "#2563eb", weight: 5, opacity: .82, lineJoin: "round" }
    ).addTo(mapRef.current);
    routeLayerRef.current.bringToBack();
  }, [geometry, mapReady]);

  return <section className={`employee-map-panel ${desktop ? "employee-map-desktop" : ""}`}>
    <div className="employee-map-toolbar">
      <div><strong>{points.length}/{route.length} properties mapped</strong><span>{mapStatus}{locationMessage ? ` · ${locationMessage}` : ""}</span></div>
      <div className="employee-map-toolbar-actions"><button type="button" onClick={fitRoute} disabled={!points.length}>Fit Route</button><button type="button" onClick={recenterMe}>Recenter Me</button></div>
    </div>
    {unmapped.length > 0 && <p className="employee-map-notice">{unmapped.length} {unmapped.length === 1 ? "property is" : "properties are"} Not mapped.</p>}
    <div ref={mapNode} className="employee-route-map" aria-label="Interactive map of assigned visits" />
    {selected && <article className="employee-map-sheet">
      <div className="employee-map-sheet-main">
        <span className="employee-map-sequence" style={{ background: selected.color }}>{points.findIndex(point => point.id === selected.id) + 1}</span>
        <div><strong>{selected.address}</strong><span>{selected.name} · {selected.service}</span></div>
        <b style={{ color: selected.color }}>{selected.label}</b>
      </div>
      <div className="employee-map-sheet-actions"><button type="button" onClick={() => onOpenVisit(selected)}>Open Visit</button><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selected.address)}&travelmode=driving`} target="_blank" rel="noreferrer">Directions</a></div>
    </article>}
  </section>;
}
