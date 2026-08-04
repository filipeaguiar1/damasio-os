"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RouteLead } from "@/lib/services/schedulingService";
import type { RouteLineString } from "@/lib/maps/types";

declare global {
  interface Window { L?: any }
}

type Origin = { latitude: number; longitude: number; label: string };
export type RoutePreviewMetrics = { distanceMeters: number | null; durationSeconds: number | null };
type Props = {
  route: RouteLead[];
  origin: Origin | null;
  capacity: number;
  lockedJobIds?: string[];
  onRemove: (home: RouteLead) => void;
  onMetricsChange?: (metrics: RoutePreviewMetrics) => void;
};

function jobId(home: RouteLead) { return home.canonicalJobId || home.id }
function distanceLabel(value: number | null) { return value === null ? "—" : `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} km` }
function durationLabel(value: number | null) { return value === null ? "—" : `${Math.max(1, Math.round(value / 60))} min` }

function ensureLeaflet(): Promise<any> {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    if (!document.querySelector("link[data-leaflet]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.dataset.leaflet = "true";
      document.head.appendChild(link);
    }
    let script = document.querySelector("script[data-leaflet]") as HTMLScriptElement | null;
    const finish = () => window.L ? resolve(window.L) : reject(new Error("Leaflet did not load."));
    if (!script) {
      script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.async = true;
      script.dataset.leaflet = "true";
      document.body.appendChild(script);
    }
    if (window.L) return finish();
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("Leaflet failed to load.")), { once: true });
    window.setTimeout(finish, 1500);
  });
}

export function InteractiveRoutePreviewMap({ route, origin, capacity, lockedJobIds = [], onRemove, onMetricsChange }: Props) {
  const node = useRef<HTMLDivElement | null>(null);
  const map = useRef<any>(null);
  const markerLayer = useRef<any>(null);
  const lineLayer = useRef<any>(null);
  const [geometry, setGeometry] = useState<RouteLineString | null>(null);
  const [metrics, setMetrics] = useState<RoutePreviewMetrics>({ distanceMeters: null, durationSeconds: null });
  const [status, setStatus] = useState("Preparing route preview...");
  const [roadReady, setRoadReady] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const locked = useMemo(() => new Set(lockedJobIds), [lockedJobIds]);
  const routeKey = route.map(item => `${jobId(item)}:${item.latitude}:${item.longitude}:${item.routeOrder || ""}`).join("|");
  const originKey = origin ? `${origin.latitude}:${origin.longitude}` : "";

  useEffect(() => {
    let cancelled = false;
    const coordinates: [number, number][] = [
      ...(origin ? [[origin.longitude, origin.latitude] as [number, number]] : []),
      ...route.flatMap(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
        ? [[Number(item.longitude), Number(item.latitude)] as [number, number]] : []),
    ];
    if (coordinates.length < 2) {
      const next = { distanceMeters: null, durationSeconds: null };
      setGeometry(null); setRoadReady(false); setMetrics(next); onMetricsChange?.(next);
      setStatus(route.length ? "The houses are selected, but a valid start point is required." : "Select houses and tap Create route preview.");
      return;
    }
    const fallback: RouteLineString = { type: "LineString", coordinates };
    setGeometry(fallback); setRoadReady(false); setStatus("Preview ready. Calculating the road line...");
    void fetch("/api/map/route", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coordinates }),
    }).then(async response => {
      if (!response.ok) throw new Error("Road route unavailable");
      return await response.json() as { geometry: RouteLineString; distance: number; duration: number };
    }).then(result => {
      if (cancelled) return;
      const next = {
        distanceMeters: Number.isFinite(result.distance) ? result.distance : null,
        durationSeconds: Number.isFinite(result.duration) ? result.duration : null,
      };
      setGeometry(result.geometry?.coordinates?.length ? result.geometry : fallback);
      setRoadReady(Boolean(result.geometry?.coordinates?.length)); setMetrics(next); onMetricsChange?.(next);
      setStatus("Preview confirmed. Review the order before publishing.");
    }).catch(() => {
      if (cancelled) return;
      const next = { distanceMeters: null, durationSeconds: null };
      setGeometry(fallback); setRoadReady(false); setMetrics(next); onMetricsChange?.(next);
      setStatus("Order preview is available. The road line is temporarily simplified.");
    });
    return () => { cancelled = true };
  }, [routeKey, originKey, onMetricsChange]);

  useEffect(() => {
    let cancelled = false;
    void ensureLeaflet().then(L => {
      if (cancelled || !node.current) return;
      if (!map.current) {
        map.current = L.map(node.current, { zoomControl: true, attributionControl: false }).setView([43.2557, -79.8711], 11);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map.current);
        markerLayer.current = L.layerGroup().addTo(map.current);
      }
      setMapReady(true);
      window.setTimeout(() => map.current?.invalidateSize(), 80);
    }).catch(() => { if (!cancelled) setStatus("The route order is ready, but the map library could not load.") });
    return () => { cancelled = true };
  }, []);

  useEffect(() => {
    if (!mapReady || !map.current || !window.L || !markerLayer.current) return;
    const L = window.L;
    markerLayer.current.clearLayers();
    if (origin) {
      const icon = L.divIcon({ className: "advisor-marker-shell", html: '<div class="advisor-origin">S</div>', iconSize: [38, 38], iconAnchor: [19, 19] });
      L.marker([origin.latitude, origin.longitude], { icon }).bindTooltip(origin.label).addTo(markerLayer.current);
    }
    route.forEach((home, index) => {
      if (!Number.isFinite(home.latitude) || !Number.isFinite(home.longitude)) return;
      const isLocked = locked.has(jobId(home));
      const icon = L.divIcon({ className: "advisor-marker-shell", html: `<button class="advisor-stop ${isLocked ? "locked" : ""}">${index + 1}</button>`, iconSize: [38, 38], iconAnchor: [19, 19] });
      const marker = L.marker([Number(home.latitude), Number(home.longitude)], { icon }).bindTooltip(`${index + 1}. ${home.name}`);
      if (!isLocked) marker.on("click", () => onRemove(home));
      marker.addTo(markerLayer.current);
    });
    const bounds: [number, number][] = [
      ...(origin ? [[origin.latitude, origin.longitude] as [number, number]] : []),
      ...route.flatMap(home => Number.isFinite(home.latitude) && Number.isFinite(home.longitude)
        ? [[Number(home.latitude), Number(home.longitude)] as [number, number]] : []),
    ];
    if (bounds.length) map.current.fitBounds(L.latLngBounds(bounds).pad(.2), { maxZoom: 15 });
    window.setTimeout(() => map.current?.invalidateSize(), 80);
  }, [mapReady, routeKey, originKey, locked, onRemove]);

  useEffect(() => {
    if (!mapReady || !map.current || !window.L) return;
    if (lineLayer.current) map.current.removeLayer(lineLayer.current);
    lineLayer.current = null;
    if (!geometry?.coordinates?.length) return;
    lineLayer.current = window.L.polyline(
      geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]),
      { color: "#2563eb", weight: roadReady ? 5 : 4, opacity: roadReady ? .84 : .62, dashArray: roadReady ? undefined : "9 8", lineJoin: "round" },
    ).addTo(map.current);
    lineLayer.current.bringToBack();
  }, [mapReady, geometry, roadReady]);

  const safeCapacity = Math.max(1, capacity || 1);
  return <section className="advisor-preview-map">
    <div className="advisor-mobile-preview-title"><span>ROUTE PREVIEW</span><strong>Review before publishing</strong></div>
    <div className="advisor-preview-status">
      <div><strong>{route.length}/{safeCapacity} houses · {roadReady ? "road route" : "ordered route"}</strong><span>{status}</span></div>
      <dl><div><dt>Distance</dt><dd>{distanceLabel(metrics.distanceMeters)}</dd></div><div><dt>Driving</dt><dd>{durationLabel(metrics.durationSeconds)}</dd></div></dl>
    </div>
    <div ref={node} className="advisor-preview-leaflet" aria-label="Synchronized canonical route preview" />
    <div className="advisor-preview-order-strip">{route.map((home, index) => <span key={jobId(home)}><b>{index + 1}</b>{home.name}</span>)}</div>
    <style jsx global>{`
      .advisor-preview-map{display:block!important;width:100%!important;min-width:0!important;overflow:hidden;border:2px solid #8bc6a8;border-radius:22px;background:#fff;box-shadow:0 12px 30px rgba(19,52,39,.1)}
      .advisor-mobile-preview-title{display:none;padding:13px 15px;background:#0b7046;color:#fff}.advisor-mobile-preview-title span,.advisor-mobile-preview-title strong{display:block}.advisor-mobile-preview-title span{font-size:9px;font-weight:950;letter-spacing:.12em}.advisor-mobile-preview-title strong{margin-top:3px;font-size:17px}
      .advisor-preview-status{display:flex;justify-content:space-between;gap:16px;padding:13px 16px;border-bottom:1px solid #e4ece8;background:#f7fbf9}.advisor-preview-status>div strong,.advisor-preview-status>div span{display:block}.advisor-preview-status>div span{margin-top:3px;color:#64748b;font-size:12px}.advisor-preview-status dl{display:flex;gap:18px;margin:0}.advisor-preview-status dl div{display:grid;gap:2px}.advisor-preview-status dt{color:#64748b;font-size:9px;font-weight:900;text-transform:uppercase}.advisor-preview-status dd{margin:0;color:#173a2c;font-weight:950}
      .advisor-preview-leaflet{display:block!important;width:100%!important;height:520px;min-height:400px;background:#e8f1ec;position:relative;z-index:1}.advisor-marker-shell{background:transparent;border:0}.advisor-stop,.advisor-origin{display:grid;place-items:center;width:36px;height:36px;border:3px solid #fff;border-radius:50%;box-shadow:0 7px 18px rgba(15,23,42,.28);font-weight:950}.advisor-stop{background:#2563eb;color:#fff}.advisor-stop.locked{background:#16a34a}.advisor-origin{background:#111827;color:#fff}
      .advisor-preview-order-strip{display:none;gap:7px;overflow-x:auto;padding:10px;background:#f7fbf9}.advisor-preview-order-strip span{display:flex;align-items:center;gap:6px;min-width:max-content;padding:7px 9px;border:1px solid #dbe7e1;border-radius:999px;background:#fff;font-size:10px}.advisor-preview-order-strip b{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#2563eb;color:#fff;font-size:9px}
      @media(max-width:800px){.mobile-route-advisor .advisor-preview-map{order:-10!important;margin:0 0 12px!important}.advisor-mobile-preview-title{display:block}.advisor-preview-leaflet{height:390px!important;min-height:350px!important}.advisor-preview-status{align-items:flex-start;flex-direction:column}.advisor-preview-status dl{width:100%;justify-content:space-between}.advisor-preview-order-strip{display:flex}.mobile-route-advisor .advisor-main{display:grid!important}.mobile-route-advisor .advisor-manual-order{order:2}.mobile-route-advisor .advisor-publish-bar{order:3}}
    `}</style>
  </section>;
}
