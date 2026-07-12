"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Lead } from "@/lib/storage";
import { getEmployeeTasks, getSessionForLead } from "@/lib/storage";

declare global { interface Window { L?: any } }

type Point = Lead & { latitude: number; longitude: number; color: string; label: string };
type CachedCoordinate = { latitude: number; longitude: number; displayName?: string };

type Props = {
  route: Lead[];
  onOpenVisit: (lead: Lead) => void;
};

const CACHE_KEY = "damasio_os_geocode_cache_v1";
const HAMILTON: [number, number] = [43.2557, -79.8711];

function stateFor(lead: Lead) {
  const session = getSessionForLead(lead.id);
  const issue = getEmployeeTasks().some(task => task.leadId === lead.id && task.status !== "resolved");
  if (issue) return { color: "#dc2626", label: "Issue" };
  if (session?.status === "skipped") return { color: "#eab308", label: "Skipped" };
  if (lead.status === "completed" || session?.status === "finished") return { color: "#16a34a", label: "Done" };
  return { color: "#2563eb", label: "Open" };
}

function readCache(): Record<string, CachedCoordinate> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
}
function writeCache(cache: Record<string, CachedCoordinate>) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}
function sleep(ms: number) { return new Promise(resolve => window.setTimeout(resolve, ms)); }

export function EmployeeRouteMap({ route, onOpenVisit }: Props) {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const [coordinates, setCoordinates] = useState<Record<string, CachedCoordinate>>({});
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function resolveAddresses() {
      const cache = readCache();
      const next = { ...cache };
      setLoading(true);
      setNotice("");
      for (const lead of route) {
        if (cancelled) return;
        if (typeof lead.latitude === "number" && typeof lead.longitude === "number") {
          next[lead.id] = { latitude: lead.latitude, longitude: lead.longitude, displayName: lead.address };
          continue;
        }
        if (next[lead.id]) continue;
        try {
          const response = await fetch(`/api/map/geocode?address=${encodeURIComponent(lead.address)}`, { cache: "no-store" });
          if (!response.ok) throw new Error("Address not found");
          next[lead.id] = await response.json() as CachedCoordinate;
          writeCache(next);
          setCoordinates({ ...next });
        } catch {
          setNotice("Some addresses could not be placed. Check the full street address in the property profile.");
        }
        await sleep(1100);
      }
      if (!cancelled) { setCoordinates(next); setLoading(false); }
    }
    resolveAddresses();
    return () => { cancelled = true; };
  }, [route]);

  const points = useMemo<Point[]>(() => route.flatMap(lead => {
    const coordinate = coordinates[lead.id] || (typeof lead.latitude === "number" && typeof lead.longitude === "number" ? { latitude: lead.latitude, longitude: lead.longitude } : null);
    return coordinate ? [{ ...lead, ...coordinate, ...stateFor(lead) }] : [];
  }), [route, coordinates]);
  const selected = points.find(point => point.id === selectedId) || points[0] || null;

  useEffect(() => {
    let cancelled = false;
    const setup = () => {
      if (cancelled || !mapNode.current || !window.L) return;
      const L = window.L;
      if (!mapRef.current) {
        mapRef.current = L.map(mapNode.current, { zoomControl: true, attributionControl: true }).setView(HAMILTON, 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(mapRef.current);
        markerLayerRef.current = L.layerGroup().addTo(mapRef.current);
      }
      markerLayerRef.current.clearLayers();
      points.forEach((point, index) => {
        const active = selected?.id === point.id;
        const icon = L.divIcon({
          className: "employee-map-marker-shell",
          html: `<div class="employee-map-marker ${active ? "active" : ""}" style="background:${point.color}">${index + 1}</div>`,
          iconSize: [active ? 40 : 34, active ? 40 : 34],
          iconAnchor: [active ? 20 : 17, active ? 20 : 17]
        });
        L.marker([point.latitude, point.longitude], { icon }).on("click", () => setSelectedId(point.id)).addTo(markerLayerRef.current);
      });
      if (points.length) {
        const bounds = L.latLngBounds(points.map(point => [point.latitude, point.longitude]));
        mapRef.current.fitBounds(bounds.pad(.16), { maxZoom: 16 });
      }
      window.setTimeout(() => mapRef.current?.invalidateSize(), 80);
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
      return () => { cancelled = true; script?.removeEventListener("load", setup); };
    }
    return () => { cancelled = true; };
  }, [points, selected?.id]);

  useEffect(() => {
    let cancelled = false;
    async function drawRoadRoute() {
      if (!mapRef.current || !window.L) return;
      if (routeLayerRef.current) { mapRef.current.removeLayer(routeLayerRef.current); routeLayerRef.current = null; }
      if (points.length < 2) return;
      setRouteLoading(true);
      try {
        const response = await fetch("/api/map/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coordinates: points.map(point => [point.longitude, point.latitude]) })
        });
        if (!response.ok) throw new Error("Road route unavailable");
        const data = await response.json() as { geometry: { coordinates: Array<[number, number]> } };
        if (cancelled) return;
        const latLngs = data.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]);
        routeLayerRef.current = window.L.polyline(latLngs, { color: "#2563eb", weight: 5, opacity: .82, lineJoin: "round" }).addTo(mapRef.current);
        routeLayerRef.current.bringToBack();
      } catch {
        if (!cancelled) setNotice("The road route could not be calculated right now. The homes are still shown in their mapped positions.");
      } finally { if (!cancelled) setRouteLoading(false); }
    }
    drawRoadRoute();
    return () => { cancelled = true; };
  }, [points]);

  function recenter() {
    if (!mapRef.current || !window.L || !points.length) return;
    const bounds = window.L.latLngBounds(points.map(point => [point.latitude, point.longitude]));
    mapRef.current.fitBounds(bounds.pad(.16), { maxZoom: 16 });
  }

  return <section className="employee-map-panel">
    <div className="employee-map-toolbar">
      <div><strong>{points.length}/{route.length} homes mapped</strong><span>{routeLoading ? "Calculating road route…" : loading ? "Locating addresses…" : "Driving route"}</span></div>
      <button type="button" onClick={recenter}>Recenter</button>
    </div>
    {notice && <p className="employee-map-notice">{notice}</p>}
    <div ref={mapNode} className="employee-route-map" aria-label="Interactive map of assigned route" />
    {selected && <article className="employee-map-sheet">
      <div className="employee-map-sheet-main">
        <span className="employee-map-sequence" style={{ background: selected.color }}>{points.findIndex(point => point.id === selected.id) + 1}</span>
        <div><strong>{selected.address}</strong><span>{selected.name} · {selected.service}</span></div>
        <b style={{ color: selected.color }}>{selected.label}</b>
      </div>
      <div className="employee-map-sheet-actions">
        <button type="button" onClick={() => onOpenVisit(selected)}>Open visit</button>
        <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selected.address)}&travelmode=driving`} target="_blank" rel="noreferrer">Directions</a>
      </div>
    </article>}
  </section>;
}
