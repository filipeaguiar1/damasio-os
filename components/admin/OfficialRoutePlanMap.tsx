"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
type AdminCustomerRecord = {
  customer: {
    full_name?: string | null;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
  };
  property: {
    address_line1?: string | null;
    city?: string | null;
    province?: string | null;
    postal_code?: string | null;
    lot_size?: string | null;
    grass_height?: string | null;
    gate?: boolean | null;
    dog?: boolean | null;
    irrigation?: boolean | null;
    access_notes?: string | null;
    property_notes?: string | null;
    official_photo_url?: string | null;
  };
  permissions?: {
    contactHidden?: boolean;
  };
};

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

function sameWorkerPoints(current: WorkerPoint[], next: WorkerPoint[]) {
  if (current.length !== next.length) return false;
  return current.every((point, index) => {
    const candidate = next[index];
    return Boolean(candidate)
      && point.id === candidate.id
      && point.count === candidate.count
      && point.latitude === candidate.latitude
      && point.longitude === candidate.longitude;
  });
}

function statusLabel(home: RouteLead) {
  if (home.canonicalVisitStatus === "completed") return "Done";
  if (home.canonicalVisitStatus === "missed") return "Skipped";
  if (home.canonicalVisitStatus === "in_progress") return "Active";
  return "Scheduled";
}

function propertyAddress(record: AdminCustomerRecord | null, fallback: string) {
  const property = record?.property;
  return [property?.address_line1, property?.city, property?.province, property?.postal_code]
    .filter(Boolean)
    .join(", ") || fallback;
}

function yesNo(value?: boolean | null) {
  return value ? "Yes" : "No";
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
  const [selectedHome, setSelectedHome] = useState<RouteLead | null>(null);
  const [customerRecord, setCustomerRecord] = useState<AdminCustomerRecord | null>(null);
  const [customerMessage, setCustomerMessage] = useState("");
  const [workerPoints, setWorkerPoints] = useState<WorkerPoint[]>([]);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [message, setMessage] = useState("Loading official routes...");
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const overviewDidFit = useRef(false);
  const overviewUserMoved = useRef(false);
  const customerRequest = useRef(0);

  async function refresh() {
    try {
      const accessToken = await token();
      const response = await fetch(`/api/admin/routes?date=${encodeURIComponent(date)}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
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
  }, [date]);

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
      if (cancelled) return;
      const next = points.filter((point): point is WorkerPoint => Boolean(point));
      setWorkerPoints(current => sameWorkerPoints(current, next) ? current : next);
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
        mapRef.current.on("dragstart", () => { overviewUserMoved.current = true; });
        mapRef.current.on("zoomstart", () => { overviewUserMoved.current = true; });
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
          .on("click", () => {
            setSelectedHome(null);
            setCustomerRecord(null);
            setCustomerMessage("");
            setSelectedId(point.id);
          })
          .addTo(layerRef.current);
      });
      if (workerPoints.length && !overviewDidFit.current && !overviewUserMoved.current) {
        overviewDidFit.current = true;
        mapRef.current.fitBounds(L.latLngBounds(workerPoints.map(point => [point.latitude, point.longitude])).pad(.28), { maxZoom: 13 });
      }
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

  function closeEmployeeRoute() {
    setSelectedId("");
    setSelectedHome(null);
    setCustomerRecord(null);
    setCustomerMessage("");
    overviewDidFit.current = false;
    overviewUserMoved.current = false;
  }

  async function openCustomer(home: RouteLead) {
    const request = ++customerRequest.current;
    setSelectedHome(home);
    setCustomerRecord(null);
    setCustomerMessage("Loading customer and property...");
    if (!home.canonicalCustomerId) {
      setCustomerMessage("This route stop is missing its canonical Customer ID.");
      return;
    }
    try {
      const accessToken = await token();
      const response = await fetch(`/api/admin/customers/${encodeURIComponent(home.canonicalCustomerId)}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customer profile could not be loaded.");
      if (request !== customerRequest.current) return;
      setCustomerRecord(result as AdminCustomerRecord);
      setCustomerMessage("");
    } catch (error) {
      if (request !== customerRequest.current) return;
      setCustomerMessage(error instanceof Error ? error.message : "Customer profile could not be loaded.");
    }
  }

  return <article className="studio-panel route-map-panel official-route-plan">
    <header>
      <h2>{selectedEmployee ? `${selectedEmployee.name} Route` : "Route Plan"}</h2>
      <div className="studio-map-tools">
        {selectedEmployee && <button type="button" onClick={closeEmployeeRoute}>Back</button>}
        <label><span>Calendar</span><input type="date" value={date} onChange={event => { setDate(event.target.value); closeEmployeeRoute(); }} /></label>
        <button type="button" onClick={() => void refresh()}>Refresh</button>
      </div>
    </header>
    {message && <div className="studio-empty">{message}</div>}
    {!selectedEmployee ? <>
      <div className={`${styles.overviewMap} studio-map real-map official-route-overview`}>
        <div ref={mapNode} className="studio-preview-leaflet" />
      </div>
      <div className="official-route-worker-list" aria-label="Published employee routes" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 12 }}>
        {employees.map(employee => <button
          type="button"
          key={employee.id}
          className="official-route-worker-button studio-route-stop"
          data-employee-id={employee.id}
          onClick={() => {
            setSelectedHome(null);
            setCustomerRecord(null);
            setCustomerMessage("");
            setSelectedId(employee.id);
          }}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 48, padding: "10px 12px" }}
        >
          <strong>{employee.name}</strong>
          <span>{counts.get(employee.id) || 0} house{(counts.get(employee.id) || 0) === 1 ? "" : "s"}</span>
        </button>)}
      </div>
    </> : <div className={`${styles.focusedRoute} official-route-focused`}>
      <EmployeeRouteMap route={selectedRoute} routeId={selectedRoute[0]?.canonicalRouteId} originPoint={origin} desktop actionLabel="Customer & property" onOpenVisit={openCustomer} />
      <aside className={`${styles.housePanel} studio-route-popover official-house-list`}>
        <strong>{selectedEmployee.name}</strong><small>{selectedRoute.length} clients on {date}</small>
        <div className={`${styles.houseScroll} studio-route-stop-list route-client-list`}>
          {selectedRoute.map((home, index) => <button type="button" key={home.canonicalVisitId || home.id} className={`route-client-row ${home.canonicalVisitStatus || "scheduled"}`} onClick={() => void openCustomer(home)}>
            <b>{home.routeOrder || index + 1}</b>
            <span><strong>{home.name}</strong><small>{home.address}</small></span>
            <em>{statusLabel(home)}</em>
          </button>)}
          {!selectedRoute.length && <div className="studio-empty">No published houses for this Employee and date.</div>}
        </div>
      </aside>

      {selectedHome && <aside className="route-customer-drawer" aria-label="Customer and property details">
        <header><div><small>ROUTE CLIENT</small><strong>{customerRecord?.customer.full_name || selectedHome.name}</strong></div><button type="button" aria-label="Close customer details" onClick={() => { customerRequest.current += 1; setSelectedHome(null); setCustomerRecord(null); setCustomerMessage(""); }}>×</button></header>
        <div className="route-customer-drawer-scroll">
          {customerRecord?.property.official_photo_url && <img className="route-customer-photo" src={customerRecord.property.official_photo_url} alt="Property" />}
          <section className="route-customer-summary"><span>{selectedHome.service}</span><strong>{propertyAddress(customerRecord, selectedHome.address)}</strong><small>{statusLabel(selectedHome)} · Visit {selectedHome.scheduledDate || date}</small></section>
          {customerMessage && <div className="route-customer-message">{customerMessage}</div>}
          {customerRecord && <>
            <section className="route-customer-section"><h3>Customer</h3><dl><div><dt>Name</dt><dd>{customerRecord.customer.full_name || selectedHome.name}</dd></div>{!customerRecord.permissions?.contactHidden && <><div><dt>Phone</dt><dd>{customerRecord.customer.phone || "Not set"}</dd></div><div><dt>Email</dt><dd>{customerRecord.customer.email || "Not set"}</dd></div></>}</dl>{customerRecord.customer.notes && <p>{customerRecord.customer.notes}</p>}</section>
            <section className="route-customer-section"><h3>Property</h3><dl><div><dt>Lot size</dt><dd>{customerRecord.property.lot_size || "Not set"}</dd></div><div><dt>Grass height</dt><dd>{customerRecord.property.grass_height || "Not set"}</dd></div><div><dt>Gate</dt><dd>{yesNo(customerRecord.property.gate)}</dd></div><div><dt>Dog</dt><dd>{yesNo(customerRecord.property.dog)}</dd></div><div><dt>Irrigation</dt><dd>{yesNo(customerRecord.property.irrigation)}</dd></div></dl>{customerRecord.property.access_notes && <p><b>Access:</b> {customerRecord.property.access_notes}</p>}{customerRecord.property.property_notes && <p>{customerRecord.property.property_notes}</p>}</section>
          </>}
        </div>
        {selectedHome.canonicalCustomerId && <Link className="route-customer-full" href={`/admin/customers/${selectedHome.canonicalCustomerId}?tab=property`}>Open full customer profile</Link>}
      </aside>}
    </div>}

    <style jsx>{`
      .route-client-list{gap:8px}.route-client-row{width:100%;display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:9px;align-items:center;border:1px solid #e0e9e4;border-radius:11px;padding:9px;background:#f8fbf9;color:#173629;text-align:left;cursor:pointer}.route-client-row:hover{border-color:#9bc7ab;background:#edf8f1}.route-client-row>b{width:28px;height:28px;display:grid;place-items:center;border-radius:9px;background:#0b7046;color:#fff}.route-client-row>span{min-width:0}.route-client-row>span strong,.route-client-row>span small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.route-client-row>span small{margin-top:3px;color:#6d7d74;font-size:10px}.route-client-row>em{font-style:normal;color:#62736a;font-size:10px;font-weight:900}.route-client-row.completed>em{color:#087343}.route-client-row.in_progress>em{color:#1263a1}.route-client-row.missed>em{color:#9a6700}.route-customer-drawer{position:absolute;z-index:12;top:18px;right:18px;bottom:18px;width:min(360px,calc(100% - 36px));display:grid;grid-template-rows:auto minmax(0,1fr) auto;overflow:hidden;border:1px solid #dce8e1;border-radius:16px;background:#fff;box-shadow:0 24px 60px rgba(15,39,28,.24)}.route-customer-drawer>header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 16px;border-bottom:1px solid #e7eeea;background:#fbfdfb}.route-customer-drawer>header small,.route-customer-drawer>header strong{display:block}.route-customer-drawer>header small{color:#0b7046;font-size:9px;font-weight:950;letter-spacing:.12em}.route-customer-drawer>header strong{margin-top:3px;color:#173629}.route-customer-drawer>header button{width:34px;height:34px;border:0;border-radius:10px;background:#edf4f0;color:#173629;font-size:24px;line-height:1;cursor:pointer}.route-customer-drawer-scroll{overflow-y:auto;padding:14px;scrollbar-width:thin;scrollbar-color:#0b7046 #edf5f0}.route-customer-photo{width:100%;height:150px;border-radius:13px;object-fit:cover;background:#edf3ef}.route-customer-summary{display:grid;gap:5px;margin-bottom:12px;padding:14px;border-radius:13px;background:#edf8f1}.route-customer-summary span{color:#0b7046;font-size:10px;font-weight:950;text-transform:uppercase}.route-customer-summary strong{line-height:1.3}.route-customer-summary small{color:#66776f}.route-customer-message{margin-bottom:12px;padding:12px;border-radius:12px;background:#f4f7f5;color:#617169;font-weight:800}.route-customer-section{margin-top:12px;padding:14px;border:1px solid #e1e9e4;border-radius:13px}.route-customer-section h3{margin:0 0 9px;color:#173629;font-size:15px}.route-customer-section dl{display:grid;gap:0;margin:0}.route-customer-section dl>div{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #edf1ee}.route-customer-section dl>div:last-child{border-bottom:0}.route-customer-section dt{color:#6b7b72;font-size:11px}.route-customer-section dd{margin:0;color:#173629;text-align:right;font-size:11px;font-weight:850;overflow-wrap:anywhere}.route-customer-section p{margin:10px 0 0;color:#52655b;font-size:11px;line-height:1.5}.route-customer-full{display:block;margin:12px;border-radius:11px;padding:11px 13px;background:#0b7046;color:#fff;text-align:center;text-decoration:none;font-size:12px;font-weight:950}@media(max-width:900px){.route-customer-drawer{position:fixed;z-index:1000;inset:12px;width:auto}.route-client-row{grid-template-columns:28px minmax(0,1fr)}.route-client-row>em{grid-column:2}}
    `}</style>
  </article>;
}
