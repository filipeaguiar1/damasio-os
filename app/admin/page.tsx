"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { readRoadGeometry, saveRoadGeometry } from "@/lib/maps/clientMapCache";
import {
  DAMASIO_CREWS,
  DAMASIO_WEEK_DAYS,
  DAMASIO_SYNC_EVENT,
  Lead,
  calculateVisitStatus,
  getActivityLogs,
  getEmployeeTasks,
  getExpenses,
  getEstimates,
  getInvoices,
  getLeads,
  getOperationsIntelligence,
  getServiceRequests,
  seedDemoEstimates,
  seedDemoExpenses,
  seedDemoLeads,
  seedDemoRequests,
} from "@/lib/storage";

declare global { interface Window { L?: any } }

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function niceDate(value?: string) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Not scheduled";
}

function weekDayFromDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return DAMASIO_WEEK_DAYS[(date.getDay() + 6) % 7] || "Monday";
}

export default function Admin() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stamp, setStamp] = useState("");
  const [mapDate, setMapDate] = useState(todayKey());
  const [selectedCrew, setSelectedCrew] = useState("");
  const [previewPoints, setPreviewPoints] = useState<Lead[]>([]);
  const [overviewCrewPoints, setOverviewCrewPoints] = useState<Array<{ crew: string; count: number; latitude: number; longitude: number }>>([]);
  const [previewGeometry, setPreviewGeometry] = useState<Array<[number, number]>>([]);
  const [mapStatus, setMapStatus] = useState("Choose a crew to load the saved road route.");
  const previewMapNode = useRef<HTMLDivElement | null>(null);
  const previewMapRef = useRef<any>(null);
  const previewLayerRef = useRef<any>(null);
  const previewLineRef = useRef<any>(null);

  function refresh() {
    setLeads(getLeads());
    const sync = typeof window !== "undefined" ? window.localStorage.getItem("damasio_os_last_sync") : "";
    try {
      setStamp(sync ? String(JSON.parse(sync).at || "") : "");
    } catch {
      setStamp("");
    }
  }

  useEffect(() => {
    seedDemoLeads();
    seedDemoEstimates();
    seedDemoExpenses();
    seedDemoRequests();
    refresh();
    const onSync = () => refresh();
    window.addEventListener(DAMASIO_SYNC_EVENT, onSync as EventListener);
    window.addEventListener("storage", onSync);
    const timer = setInterval(refresh, 10000);
    return () => {
      window.removeEventListener(DAMASIO_SYNC_EVENT, onSync as EventListener);
      window.removeEventListener("storage", onSync);
      clearInterval(timer);
    };
  }, []);

  const data = useMemo(() => {
    const requests = getServiceRequests();
    const invoices = getInvoices();
    const estimates = getEstimates();
    const expenses = getExpenses();
    const tasks = getEmployeeTasks();
    const today = todayKey();
    const paidInvoices = invoices.filter((invoice) => invoice.status === "paid");
    const openInvoices = invoices.filter((invoice) => invoice.status !== "paid" && invoice.status !== "rejected");
    const invoicedLeadIds = new Set(invoices.map((invoice) => invoice.leadId).filter(Boolean));
    const paidLeads = leads.filter((lead) => (lead.paymentStatus === "paid" || lead.status === "completed") && !invoicedLeadIds.has(lead.id));
    const revenue = paidLeads.reduce((sum, lead) => sum + lead.total, 0) + paidInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
    const pendingLeads = leads.filter((lead) => (lead.paymentStatus === "pending" || lead.paymentStatus === "processing") && !invoicedLeadIds.has(lead.id));
    const pending = pendingLeads.reduce((sum, lead) => sum + lead.total, 0) + openInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
    const scheduledToday = leads.filter((lead) => lead.assignedCrew && (lead.scheduledDate === today || lead.nextVisitDate === today));
    const completedToday = scheduledToday.filter((lead) => lead.status === "completed");
    const overdue = leads.filter((lead) => calculateVisitStatus(lead) === "overdue");
    const openTasks = tasks.filter((task) => task.status !== "resolved");
    const draftEstimates = estimates.filter((estimate) => estimate.status === "draft");
    const approvalQueue = [
      ...draftEstimates.map((estimate) => ({ id: estimate.id, kind: "QUOTE", title: estimate.number, subtitle: estimate.customer, amount: estimate.total, href: "/admin/estimates" })),
      ...requests.filter((request) => request.status === "pending").map((request) => ({ id: request.id, kind: "REQ", title: request.service, subtitle: request.customerName, amount: 0, href: "/admin/requests" })),
      ...openTasks.slice(0, 3).map((task) => ({ id: task.id, kind: "TASK", title: task.title, subtitle: task.customer, amount: 0, href: "/admin/tasks" })),
    ].slice(0, 7);
    return {
      requests,
      invoices,
      estimates,
      expenses,
      tasks,
      revenue,
      pending,
      scheduledToday,
      completedToday,
      overdue,
      openTasks,
      approvalQueue,
      activeCustomers: leads.filter((lead) => lead.status !== "lost"),
      intelligence: getOperationsIntelligence(),
      recentLogs: getActivityLogs().slice(0, 5),
    };
  }, [leads]);

  const onTimeRate = data.scheduledToday.length ? Math.round((data.completedToday.length / data.scheduledToday.length) * 100) : 100;
  const nextJobs = data.scheduledToday.filter((lead) => lead.status !== "completed").slice(0, 5);
  const routeCrews = DAMASIO_CREWS.slice(0, 5).map((crew, index) => {
    const jobs = leads
      .filter((lead) => lead.assignedCrew === crew && (lead.scheduledDate === mapDate || lead.nextVisitDate === mapDate || lead.serviceDay === weekDayFromDate(mapDate)))
      .sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999) || a.address.localeCompare(b.address));
    const complete = jobs.filter((lead) => lead.status === "completed").length;
    return { crew, jobs, complete, progress: jobs.length ? Math.round((complete / jobs.length) * 100) : 0, index };
  });
  const activeRouteCrews = routeCrews.filter((route) => route.jobs.length > 0);
  const focusedRoute = routeCrews.find((route) => route.crew === selectedCrew);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const firstStops = activeRouteCrews.map((route) => ({ route, first: route.jobs[0] })).filter((item) => item.first);
      const mapped = await Promise.all(firstStops.map(async ({ route, first }) => {
        if (Number.isFinite(first.latitude) && Number.isFinite(first.longitude)) {
          return { crew: route.crew, count: route.jobs.length, latitude: Number(first.latitude), longitude: Number(first.longitude) };
        }
        try {
          const response = await fetch(`/api/map/geocode?address=${encodeURIComponent(first.address)}`, { cache: "no-store" });
          if (!response.ok) return null;
          const point = await response.json() as { latitude: number; longitude: number };
          return { crew: route.crew, count: route.jobs.length, latitude: point.latitude, longitude: point.longitude };
        } catch { return null; }
      })).then((values) => values.filter((item): item is { crew: string; count: number; latitude: number; longitude: number } => Boolean(item)));
      if (!cancelled) setOverviewCrewPoints(mapped);
    })();
    return () => { cancelled = true; };
  }, [activeRouteCrews.map((route) => `${route.crew}:${route.jobs[0]?.id}:${route.jobs[0]?.address}:${route.jobs.length}`).join("|")]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!focusedRoute) {
        setPreviewPoints([]);
        setPreviewGeometry([]);
        setMapStatus(activeRouteCrews.length ? "Choose a crew to load the saved road route." : "No crews have saved routes for this day.");
        return;
      }
      setMapStatus("Mapping addresses and loading road route...");
      const mapped = await Promise.all(focusedRoute.jobs.map(async (job) => {
        if (Number.isFinite(job.latitude) && Number.isFinite(job.longitude)) return job;
        try {
          const response = await fetch(`/api/map/geocode?address=${encodeURIComponent(job.address)}`, { cache: "no-store" });
          if (!response.ok) return null;
          const point = await response.json() as { latitude: number; longitude: number };
          return { ...job, latitude: point.latitude, longitude: point.longitude };
        } catch { return null; }
      })).then((values) => values.filter((item): item is Lead => Boolean(item)));
      if (cancelled) return;
      setPreviewPoints(mapped);
      if (mapped.length < 2) {
        setPreviewGeometry([]);
        setMapStatus(mapped.length ? "Only one mapped stop found for this crew." : "No mapped stops found for this crew.");
        return;
      }
      const coordinates = mapped.map((job) => [Number(job.longitude), Number(job.latitude)] as [number, number]);
      const cached = readRoadGeometry(coordinates);
      if (cached) {
        setPreviewGeometry(cached.coordinates);
        setMapStatus(`${mapped.length} stops loaded from saved route cache.`);
        return;
      }
      try {
        const response = await fetch("/api/map/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coordinates }) });
        if (!response.ok) throw new Error("Route unavailable");
        const data = await response.json() as { geometry: { type: "LineString"; coordinates: Array<[number, number]> } };
        if (!cancelled) {
          saveRoadGeometry(coordinates, data.geometry);
          setPreviewGeometry(data.geometry.coordinates);
          setMapStatus(`${mapped.length} stops loaded on road route.`);
        }
      } catch {
        setPreviewGeometry([]);
        setMapStatus("Road route service unavailable; mapped stops are still shown.");
      }
    })();
    return () => { cancelled = true; };
  }, [focusedRoute?.crew, focusedRoute?.jobs.map((job) => `${job.id}:${job.address}:${job.routeOrder}`).join("|")]);

  useEffect(() => {
    let cancelled = false;
    const setup = () => {
      if (cancelled || !previewMapNode.current || !window.L) return;
      const L = window.L;
      if (!previewMapRef.current) {
        previewMapRef.current = L.map(previewMapNode.current, { zoomControl: false, attributionControl: false }).setView([43.2557, -79.8711], 11);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(previewMapRef.current);
        previewLayerRef.current = L.layerGroup().addTo(previewMapRef.current);
      }
      previewLayerRef.current.clearLayers();
      if (previewLineRef.current) {
        previewMapRef.current.removeLayer(previewLineRef.current);
        previewLineRef.current = null;
      }
      if (previewGeometry.length > 1 && focusedRoute) {
        previewLineRef.current = L.polyline(previewGeometry.map(([lng, lat]) => [lat, lng]), { color: "#0b7046", weight: 5, opacity: .82, lineJoin: "round" }).addTo(previewMapRef.current);
      }
      if (!focusedRoute) {
        overviewCrewPoints.forEach((point) => {
          const initial = point.crew.replace("Crew ", "").slice(0, 1);
          const icon = L.divIcon({
            className: "studio-leaflet-marker-shell",
            html: `<button class="studio-leaflet-crew" title="${point.crew} - starts at first stop"><span>${initial}</span><small>${point.count}</small></button>`,
            iconSize: [54, 54],
            iconAnchor: [27, 27],
          });
          L.marker([point.latitude, point.longitude], { icon }).on("click", () => setSelectedCrew(point.crew)).bindTooltip(`${point.crew} - first stop`).addTo(previewLayerRef.current);
        });
      }
      if (focusedRoute) previewPoints.forEach((point, index) => {
        const icon = L.divIcon({
          className: "studio-leaflet-marker-shell",
          html: `<div class="studio-leaflet-marker">${index + 1}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
        L.marker([Number(point.latitude), Number(point.longitude)], { icon }).bindTooltip(`${focusedRoute?.crew || "Crew"} - ${point.name}`).addTo(previewLayerRef.current);
      });
      if (focusedRoute && previewPoints.length) {
        const bounds = L.latLngBounds(previewPoints.map((point) => [Number(point.latitude), Number(point.longitude)]));
        previewMapRef.current.fitBounds(bounds.pad(.18), { maxZoom: 14 });
      } else if (!focusedRoute && overviewCrewPoints.length) {
        const bounds = L.latLngBounds(overviewCrewPoints.map((point) => [point.latitude, point.longitude]));
        previewMapRef.current.fitBounds(bounds.pad(.3), { maxZoom: 12 });
      }
      window.setTimeout(() => previewMapRef.current?.invalidateSize(), 80);
    };
    if (window.L) {
      setup();
      return () => { cancelled = true; };
    }
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
  }, [previewPoints, previewGeometry, focusedRoute?.crew, overviewCrewPoints]);
  const topCustomers = data.activeCustomers.slice(0, 4);
  const openInvoices = data.invoices.filter((invoice) => invoice.status !== "paid" && invoice.status !== "rejected").slice(0, 4);

  return (
    <AdminShell active="Dashboard">
      <section className="studio-page-head">
        <div>
          <h1>Operations Command Center</h1>
          <p>Live desktop view for dispatch, approvals, customers, billing and service quality.</p>
        </div>
        <div className="studio-head-actions">
          <span>Live update: {stamp ? new Date(stamp).toLocaleTimeString() : "ready"}</span>
          <Link className="btn btn-outline" href="/admin/database">Health</Link>
          <Link className="btn btn-primary" href="/admin/schedule">New Route</Link>
        </div>
      </section>

      <section className="studio-kpis">
        <Link href="/admin/schedule" className="studio-kpi"><i>S</i><span>Jobs Scheduled</span><strong>{data.scheduledToday.length}</strong><small>Today</small></Link>
        <Link href="/admin/routes" className="studio-kpi"><i>R</i><span>In Progress</span><strong>{Math.max(0, data.scheduledToday.length - data.completedToday.length)}</strong><small>Active work</small></Link>
        <Link href="/admin/tasks" className="studio-kpi"><i>T</i><span>Open Issues</span><strong>{data.openTasks.length}</strong><small>Needs attention</small></Link>
        <Link href="/admin/alerts" className="studio-kpi danger"><i>!</i><span>Overdue</span><strong>{data.overdue.length}</strong><small>Requires action</small></Link>
        <Link href="/admin/finance" className="studio-kpi"><i>$</i><span>Revenue Today</span><strong>{money(data.revenue)}</strong><small>Paid/completed</small></Link>
        <Link href="/admin/performance" className="studio-kpi"><i>%</i><span>On-Time Rate</span><strong>{onTimeRate}%</strong><small>This route day</small></Link>
      </section>

      <section className="studio-grid">
        <article className="studio-panel route-map-panel">
          <header>
            <h2>{focusedRoute ? `${focusedRoute.crew} Route` : "Route Plan"}</h2>
            <div className="studio-map-tools">
              {focusedRoute && <button type="button" onClick={() => setSelectedCrew("")}>Back</button>}
              <label><span>Calendar</span><input type="date" value={mapDate} onChange={(event) => { setMapDate(event.target.value); setSelectedCrew(""); }} /></label>
              <Link href={`/admin/map?day=${encodeURIComponent(weekDayFromDate(mapDate))}${focusedRoute ? `&crew=${encodeURIComponent(focusedRoute.crew)}` : ""}`}>Full map</Link>
            </div>
          </header>
          <div className={focusedRoute ? "studio-map route-focused real-map" : "studio-map real-map"} aria-label="Crew route preview">
            <div ref={previewMapNode} className="studio-preview-leaflet" />
            {focusedRoute ? (
              <>
                <aside className="studio-route-popover">
                  <strong>{focusedRoute.crew}</strong>
                  <small>{mapStatus}</small>
                  <div className="studio-route-stop-list">
                    {focusedRoute.jobs.map((job, index) => <Link href={`/admin/customers/${job.id}`} key={job.id}><b>{index + 1}</b><span>{job.name}</span></Link>)}
                  </div>
                  <Link className="studio-route-open" href={`/employee/route?crew=${encodeURIComponent(focusedRoute.crew)}&day=${encodeURIComponent(weekDayFromDate(mapDate))}`}>Open employee view</Link>
                </aside>
              </>
            ) : activeRouteCrews.length ? (
              <>
                <div className="studio-map-hint">Crew markers sit on each first stop. Click one to load the road route.</div>
              </>
            ) : <b>No crews have saved routes for this day.</b>}
          </div>
        </article>

        <article className="studio-panel route-timeline-panel">
          <header><h2>Employee Route Timeline</h2><Link href="/admin/routes">View routes</Link></header>
          <div className="route-timeline">
            {nextJobs.length ? nextJobs.map((job, index) => (
              <Link href={`/admin/customers/${job.id}`} key={job.id}>
                <time>{index === 0 ? "Now" : `${9 + index}:00 AM`}</time>
                <span></span>
                <div><strong>{job.name}</strong><small>{job.service} - {job.address}</small></div>
                <em>{job.status}</em>
              </Link>
            )) : <div className="studio-empty">No active employee route yet.</div>}
          </div>
        </article>

        <aside className="studio-side-stack">
          <article className="studio-panel approval-panel">
            <header><h2>Admin Approval Queue</h2><Link href="/admin/requests">View all</Link></header>
            <div className="approval-list">
              {data.approvalQueue.length ? data.approvalQueue.map((item) => (
                <Link href={item.href} key={`${item.kind}-${item.id}`}>
                  <span>{item.kind}</span>
                  <div><strong>{item.title}</strong><small>{item.subtitle}</small></div>
                  <b>{item.amount ? money(item.amount) : "Review"}</b>
                </Link>
              )) : <div className="studio-empty">No approvals waiting.</div>}
            </div>
          </article>

          <article className="studio-panel billing-panel">
            <header><h2>Customer Billing & Quotes</h2><Link href="/admin/finance">View all</Link></header>
            <div className="billing-stats">
              <div><small>Outstanding</small><strong>{money(data.pending)}</strong></div>
              <div><small>Open quotes</small><strong>{data.estimates.filter((estimate) => estimate.status === "draft").length}</strong></div>
            </div>
            <div className="invoice-list">
              {openInvoices.length ? openInvoices.map((invoice) => (
                <Link href="/admin/invoices" key={invoice.id}><span>{invoice.number}</span><strong>{invoice.customer}</strong><em>{invoice.status}</em></Link>
              )) : <div className="studio-empty">No open invoices.</div>}
            </div>
            <Link href="/admin/invoices" className="studio-wide-action">New Invoice</Link>
          </article>
        </aside>
      </section>

      <section className="studio-lower-grid">
        <article className="studio-panel customer-overview">
          <header><h2>Customer / Service Overview</h2><Link href="/admin/customers">View customers</Link></header>
          <div className="customer-card-row">
            {topCustomers.length ? topCustomers.map((customer) => (
              <Link href={`/admin/customers/${customer.id}`} key={customer.id}>
                <span>{customer.name.slice(0, 1).toUpperCase()}</span>
                <strong>{customer.name}</strong>
                <small>{customer.service}</small>
                <dl><div><dt>Next</dt><dd>{niceDate(customer.nextVisitDate || customer.scheduledDate)}</dd></div><div><dt>Spend</dt><dd>{money(customer.total)}</dd></div></dl>
              </Link>
            )) : <div className="studio-empty">No customers loaded.</div>}
          </div>
        </article>

        <article className="studio-panel route-status-panel">
          <header><h2>Route Status</h2><Link href="/admin/schedule">Dispatch</Link></header>
          <div className="route-status-list">
            {routeCrews.map((route) => (
              <Link href="/admin/routes" key={route.crew}>
                <strong>{route.crew}</strong><span>{route.jobs.length} jobs</span><div><i style={{ width: `${route.progress}%` }}></i></div><em>{route.progress}%</em>
              </Link>
            ))}
          </div>
        </article>

        <article className="studio-panel recent-activity-panel">
          <header><h2>Recent Activity</h2><Link href="/admin/logs">Logs</Link></header>
          <div className="activity-list">
            {data.recentLogs.length ? data.recentLogs.map((log) => (
              <div key={log.id}><strong>{log.action}</strong><small>{log.actor} - {log.target}</small></div>
            )) : <div className="studio-empty">No recent changes.</div>}
          </div>
        </article>
      </section>
    </AdminShell>
  );
}
