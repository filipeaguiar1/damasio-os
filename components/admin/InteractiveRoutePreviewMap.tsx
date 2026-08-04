"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RouteLead } from "@/lib/services/schedulingService";
import type { RouteLineString } from "@/lib/maps/types";

declare global {
  interface Window {
    L?: any;
  }
}

type Origin = { latitude: number; longitude: number; label: string };

export type RoutePreviewMetrics = {
  distanceMeters: number | null;
  durationSeconds: number | null;
};

type Props = {
  route: RouteLead[];
  origin: Origin | null;
  capacity: number;
  lockedJobIds?: string[];
  onRemove: (home: RouteLead) => void;
  onMetricsChange?: (metrics: RoutePreviewMetrics) => void;
};

function jobId(home: RouteLead) {
  return home.canonicalJobId || home.id;
}

function formatDistance(value: number | null) {
  return value === null ? "—" : `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} km`;
}

function formatDuration(value: number | null) {
  return value === null ? "—" : `${Math.max(1, Math.round(value / 60))} min`;
}

export function InteractiveRoutePreviewMap({
  route,
  origin,
  capacity,
  lockedJobIds = [],
  onRemove,
  onMetricsChange,
}: Props) {
  const node = useRef<HTMLDivElement | null>(null);
  const map = useRef<any>(null);
  const markerLayer = useRef<any>(null);
  const lineLayer = useRef<any>(null);
  const [geometry, setGeometry] = useState<RouteLineString | null>(null);
  const [metrics, setMetrics] = useState<RoutePreviewMetrics>({
    distanceMeters: null,
    durationSeconds: null,
  });
  const [status, setStatus] = useState("Preparing preview...");
  const [roadReady, setRoadReady] = useState(false);
  const locked = useMemo(() => new Set(lockedJobIds), [lockedJobIds]);
  const routeKey = route
    .map(item => `${jobId(item)}:${item.latitude}:${item.longitude}:${item.routeOrder || ""}`)
    .join("|");
  const originKey = origin ? `${origin.latitude}:${origin.longitude}` : "";

  useEffect(() => {
    let cancelled = false;
    const coordinates = [
      ...(origin ? [[origin.longitude, origin.latitude] as [number, number]] : []),
      ...route.flatMap(item =>
        Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
          ? [[Number(item.longitude), Number(item.latitude)] as [number, number]]
          : []),
    ];

    if (coordinates.length < 2) {
      const next = { distanceMeters: null, durationSeconds: null };
      setGeometry(null);
      setRoadReady(false);
      setMetrics(next);
      onMetricsChange?.(next);
      setStatus(route.length
        ? "Add a valid Employee route start to calculate the road line."
        : "Select houses to preview the route.");
      return () => { cancelled = true; };
    }

    const fallback: RouteLineString = { type: "LineString", coordinates };
    setGeometry(fallback);
    setRoadReady(false);
    setStatus("Preview ready. Refining the line along public roads...");

    void fetch("/api/map/route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinates }),
    })
      .then(async response => {
        if (!response.ok) throw new Error("Route unavailable");
        return await response.json() as {
          geometry: RouteLineString;
          distance: number;
          duration: number;
        };
      })
      .then(result => {
        if (cancelled) return;
        const next = {
          distanceMeters: Number.isFinite(result.distance) ? result.distance : null,
          durationSeconds: Number.isFinite(result.duration) ? result.duration : null,
        };
        setGeometry(result.geometry?.coordinates?.length ? result.geometry : fallback);
        setRoadReady(Boolean(result.geometry?.coordinates?.length));
        setMetrics(next);
        onMetricsChange?.(next);
        setStatus("Preview confirmed: markers, order, road line, distance and duration match.");
      })
      .catch(() => {
        if (cancelled) return;
        const next = { distanceMeters: null, durationSeconds: null };
        setGeometry(fallback);
        setRoadReady(false);
        setMetrics(next);
        onMetricsChange?.(next);
        setStatus("Preview is visible with the reviewed order. Road metrics are temporarily unavailable.");
      });

    return () => { cancelled = true; };
  }, [routeKey, originKey, onMetricsChange]);

  useEffect(() => {
    let cancelled = false;

    const setup = () => {
      if (cancelled || !node.current || !window.L) return;
      const L = window.L;

      if (!map.current) {
        map.current = L
          .map(node.current, { zoomControl: true, attributionControl: false })
          .setView([43.2557, -79.8711], 11);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
        }).addTo(map.current);
        markerLayer.current = L.layerGroup().addTo(map.current);
      }

      markerLayer.current.clearLayers();

      if (origin) {
        const icon = L.divIcon({
          className: "advisor-marker-shell",
          html: '<div class="advisor-origin">S</div>',
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        });
        L.marker([origin.latitude, origin.longitude], { icon })
          .bindTooltip(origin.label)
          .addTo(markerLayer.current);
      }

      route.forEach((home, index) => {
        if (!Number.isFinite(home.latitude) || !Number.isFinite(home.longitude)) return;
        const isLocked = locked.has(jobId(home));
        const icon = L.divIcon({
          className: "advisor-marker-shell",
          html: `<button class="advisor-stop ${isLocked ? "locked" : ""}" title="${
            isLocked ? "Completed house locked" : `Remove ${home.name}`
          }">${index + 1}</button>`,
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        });
        const marker = L
          .marker([Number(home.latitude), Number(home.longitude)], { icon })
          .bindTooltip(`${index + 1}. ${home.name} · ${isLocked ? "completed and locked" : "click to remove"}`);
        if (!isLocked) marker.on("click", () => onRemove(home));
        marker.addTo(markerLayer.current);
      });

      const bounds = [
        ...(origin ? [[origin.latitude, origin.longitude] as [number, number]] : []),
        ...route.flatMap(home =>
          Number.isFinite(home.latitude) && Number.isFinite(home.longitude)
            ? [[Number(home.latitude), Number(home.longitude)] as [number, number]]
            : []),
      ];
      if (bounds.length) map.current.fitBounds(L.latLngBounds(bounds).pad(.2), { maxZoom: 15 });
      window.setTimeout(() => map.current?.invalidateSize(), 50);
    };

    if (window.L) {
      setup();
    } else {
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
  }, [routeKey, originKey, locked, onRemove]);

  useEffect(() => {
    if (!map.current || !window.L) return;
    if (lineLayer.current) {
      map.current.removeLayer(lineLayer.current);
      lineLayer.current = null;
    }
    if (!geometry?.coordinates?.length) return;
    lineLayer.current = window.L.polyline(
      geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]),
      {
        color: "#2563eb",
        weight: roadReady ? 5 : 4,
        opacity: roadReady ? .82 : .58,
        dashArray: roadReady ? undefined : "9 8",
        lineJoin: "round",
      },
    ).addTo(map.current);
    lineLayer.current.bringToBack();
  }, [geometry, roadReady]);

  const safeCapacity = Math.max(1, capacity || 1);

  return <section className="advisor-preview-map">
    <div className="advisor-preview-status">
      <div><strong>{route.length}/{safeCapacity} houses · {roadReady ? "road preview" : "order preview"}</strong><span>{status}</span></div>
      <dl>
        <div><dt>Distance</dt><dd>{formatDistance(metrics.distanceMeters)}</dd></div>
        <div><dt>Driving</dt><dd>{formatDuration(metrics.durationSeconds)}</dd></div>
      </dl>
    </div>
    <div ref={node} className="advisor-preview-leaflet" aria-label="Synchronized canonical route preview" />
    <style jsx global>{`
      .advisor-preview-map{overflow:hidden;border:2px solid #b9d8c8;border-radius:22px;background:#fff;box-shadow:0 12px 30px rgba(19,52,39,.08)}
      .advisor-preview-status{display:flex;justify-content:space-between;gap:16px;padding:13px 16px;border-bottom:1px solid #e4ece8;background:#f7fbf9}
      .advisor-preview-status>div strong,.advisor-preview-status>div span{display:block}.advisor-preview-status>div span{margin-top:3px;color:#64748b;font-size:12px}
      .advisor-preview-status dl{display:flex;gap:18px;margin:0}.advisor-preview-status dl div{display:grid;gap:2px}.advisor-preview-status dt{color:#64748b;font-size:9px;font-weight:900;text-transform:uppercase}.advisor-preview-status dd{margin:0;color:#173a2c;font-weight:950}
      .advisor-preview-leaflet{height:520px;min-height:400px}
      .advisor-marker-shell{background:transparent;border:0}
      .advisor-stop,.advisor-origin{display:grid;place-items:center;width:36px;height:36px;border:3px solid #fff;border-radius:50%;box-shadow:0 7px 18px rgba(15,23,42,.28);font-weight:950}
      .advisor-stop{background:#2563eb;color:#fff;cursor:pointer}.advisor-stop:hover{background:#dc2626;transform:scale(1.08)}
      .advisor-stop.locked{background:#16a34a;cursor:not-allowed}.advisor-stop.locked:hover{background:#16a34a;transform:none}
      .advisor-origin{background:#111827;color:#fff}
      @media(max-width:800px){.advisor-preview-leaflet{height:390px;min-height:340px}.advisor-preview-status{align-items:flex-start;flex-direction:column}.advisor-preview-status dl{width:100%;justify-content:space-between}}
    `}</style>
  </section>;
}
