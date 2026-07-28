"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";
import { belongsToCanonicalEmployee } from "@/lib/routes/canonicalRouteIdentity";
import { operationalDateKey } from "@/lib/dates/operationalDate";
import styles from "./officialRoutePanels.module.css";

declare global { interface Window { L?: any } }

type RouteEmployee = {
  id: string;
  employeeId: string | null;
  crewId: string;
  name: string;
  email: string;
  routeStartAddress: string | null;
};

type Origin = { latitude: number; longitude: number; label: string };
type WorkerPoint = Origin & { id: string; name: string; count: number; index: number };
type Props = { date?: string; onDateChange?: (date: string) => void };

async function token() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new Error("Your Admin session expired. Sign in again.");
  return value;
}

async function geocode(address: string) {
  const response = await fetch(`/api/map/geocode?address=${encodeURIComponent(address)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Address could not be mapped.");
  return await response.json() as { latitude: number; longitude: number };
}

export function OfficialRoutePlanMap({ date: controlledDate, onDateChange }: Props = {}) {
  const [internalDate, setInternalDate] = useState(operationalDateKey());
  const date = controlledDate || internalDate;
  const setDate = (next: string) => {
    if (!controlledDate) setInternalDate(next);
    onDateChange?.(next);
  };
  const [employees, setEmployees] = useState<RouteEmployee[]>([]);
  const [leads, setLeads] = useState<RouteLead[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [workerPoints, setWorkerPoints] = useState<WorkerPoint[]>([]);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [message, setMessage] = useState("Loading official routes...");
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  async function refresh() {
    try {
      const accessToken = await token();
      const response = await fetch("/api/admin/routes", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Routes could not be loaded.");
      setEmployees(result.employees || []);
      setLeads(schedulingBoardToLeads((result.board || {}) as SchedulingDispatchBoard));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Routes could not be loaded.");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const visits = useMemo(() => leads.filter(item =>
    Boolean(item.canonicalVisitId)
    && Boolean(item.canonicalRouteId)
    && item.scheduledDate === date
    && item.canonicalVisitStatus !== "cancelled"), [leads, date]);
  const selectedEmployee = employees.find(item => item.id === selectedId) || null;
  const selectedIdentity = selectedEmployee ? { id: selectedEmployee.employeeId || selectedEmployee.id, crewId: selectedEmployee.crewId } : null;
  const selectedRoute = useMemo(() => selectedIdentity
    ? visits.filter(item => belongsToCanonicalEmployee(item, selectedIdentity)).sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999))
    : [], [visits, selectedIdentity?.id, selectedIdentity?.crewId]);

  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const employee of employees) {
      const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId };
      result.set(employee.id, visits.filter(item => belongsToCanonicalEmployee(item, identity)).length);
    }
    return result;
  }, [employees, visits]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(employees.map(async (employee, index) => {
      const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId };
      const firstStop = visits.find(item => belongsToCanonicalEmployee(item, identity));
      const address = employee.routeStartAddress || firstStop?.address || "";
      if (!address) return null;
      try {
        const point = await geocode(address);
        return { ...point, label: `${employee.name} start`, id: employee.id, name: employee.name, count: counts.get(employee.id) || 0, index };
      } catch {
        return null;
      }
    })).then(points => {
      if (!cancelled) setWorkerPoints(points.filter((point): point is WorkerPoint => Boolean(point)));
    });
    return () => { cancelled = true; };
  }, [employees, visits, counts]);

  useEffect(() => {
    let cancelled = false;
    const startAddress = selectedEmployee?.routeStartAddress || selectedRoute[0]?.address || "";
    if (!startAddress) {
      setOrigin(null);
      return () => { cancelled = true; };
    }
    void geocode(startAddress).then(point => {
      if (!cancelled) setOrigin({ ...point, label: `${selectedEmployee?.name || "Employee"} start` });
    }).catch(() => {
      if (!cancelled) setOrigin(null);
    });
    return () => { cancelled = true; };
  }, [selectedEmployee?.id, selectedEmployee?.routeStartAddress, selectedRoute[0]?.address]);

  useEffect(() => {
    if (!selectedEmployee) return;
    mapRef.current?.remove();
    mapRef.current = null;
    layerRef.current = null;
  }, [selectedEmployee?.id]);

  useEffect(() => () => {
    mapRef.current?.remove();
    mapRef.current = null;
    layerRef.current = null;
  }, []);

  useEffect(() => {
    if (selectedEmployee) return;
    let cancelled = false;
    const setup = () => {
      if (cancelled || !mapNode.current || !window.L) return;
      const L = window.L;
      if (!mapRef.current) {
        mapRef.current = L.map(mapNode.current, { zoomControl: true, attributionControl: false }).setView([43.2557, -79.8711], 11);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
      }
      layerRef.current.clearLayers();
      workerPoints.forEach(point => {
        const icon = L.divIcon({
          className: "studio-leaflet-marker-shell",
          html: `<button class="studio-leaflet-crew" title="${point.name}"><span>${point.index + 1}</span><small>${point.count}</small></button>`,
          iconSize: [54, 54],
          iconAnchor: [27, 27],
        });
        L.marker([point.latitude, point.longitude], { icon })
          .bindTooltip(`${point.name} · ${point.count} stop${point.count === 1 ? "" : "s"}`)
          .on("click", () => setSelectedId(point.id))
          .addTo(layerRef.current);
      });
      if (workerPoints.length) mapRef.current.fitBounds(L.latLngBounds(workerPoints.map(point => [point.latitude, point.longitude])).pad(.28), { maxZoom: 13 });
      window.setTimeout(() => mapRef.current?.invalidateSize(), 60);
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
  }, [workerPoints, selectedEmployee?.id]);

  return <article className="studio-panel route-map-panel official-route-plan">
    <header>
      <h2>{selectedEmployee ? `${selectedEmployee.name} Route` : "Route Plan"}</h2>
      <div className="studio-map-tools">
        {selectedEmployee && <button type="button" onClick={() => setSelectedId("")}>Back</button>}
        <label><span>Calendar</span><input type="date" value={date} onChange={event => { setDate(event.target.value); setSelectedId(""); }} /></label>
        <button type="button" onClick={() => void refresh()}>Refresh</button>
      </div>
    </header>
    {message && <div className="studio-empty">{message}</div>}
    {!selectedEmployee ? <div className={`${styles.overviewMap} studio-map real-map official-route-overview`}>
      <div ref={mapNode} className="studio-preview-leaflet" />
    </div> : <div className={`${styles.focusedRoute} official-route-focused`}>
      <EmployeeRouteMap route={selectedRoute} routeId={selectedRoute[0]?.canonicalRouteId} originPoint={origin} desktop actionLabel="Property profile" onOpenVisit={() => {}} />
      <aside className={`${styles.housePanel} studio-route-popover official-house-list`}>
        <strong>{selectedEmployee.name}</strong><small>{selectedRoute.length} published houses on {date}</small>
        <div className={`${styles.houseScroll} studio-route-stop-list`}>
          {selectedRoute.map((home, index) => <div key={home.canonicalVisitId || home.id} className={home.canonicalVisitStatus || "scheduled"}><b>{home.routeOrder || index + 1}</b><span>{home.name}<small>{home.address}</small></span><em>{home.canonicalVisitStatus === "completed" ? "Done" : home.canonicalVisitStatus === "missed" ? "Skipped" : home.canonicalVisitStatus === "in_progress" ? "Active" : "Scheduled"}</em></div>)}
          {!selectedRoute.length && <div className="studio-empty">No published houses for this Employee and date.</div>}
        </div>
      </aside>
    </div>}
  </article>;
}
