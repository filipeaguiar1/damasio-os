"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";
import { EmployeeRouteMap } from "@/components/mobile/EmployeeRouteMap";
import { DAMASIO_CREWS, Lead } from "@/lib/storage";
import { loadSchedulingDispatchBoard, publishJobRoutePattern, rescheduleVisit, schedulingBoardToLeads } from "@/lib/services/schedulingService";
import type { DispatchCrew } from "@/lib/repositories/schedulingRepository";

type Mode = "view" | "build" | "move";
type View = "map" | "list";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function cityOf(address: string) {
  return address.split(",").slice(-2, -1)[0]?.trim() || address.split(",").pop()?.trim() || "Other";
}

export default function RoutesPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [crews, setCrews] = useState<DispatchCrew[]>([]);
  const [crew, setCrew] = useState(DAMASIO_CREWS[0]);
  const [date, setDate] = useState(todayKey());
  const [mode, setMode] = useState<Mode>("view");
  const [view, setView] = useState<View>("map");
  const [message, setMessage] = useState("Loading routes...");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [startAddress, setStartAddress] = useState("");
  const [draft, setDraft] = useState<Lead[]>([]);
  const [targetCrew, setTargetCrew] = useState(DAMASIO_CREWS[1] || DAMASIO_CREWS[0]);
  const [targetDate, setTargetDate] = useState(todayKey());

  async function refresh() {
    try {
      const board = await loadSchedulingDispatchBoard({ force: true });
      const nextLeads = schedulingBoardToLeads(board);
      setLeads(nextLeads);
      setCrews(board.crews);
      if (board.crews.length && !board.crews.some((item) => item.name === crew)) {
        setCrew(board.crews[0].name);
        setTargetCrew(board.crews[1]?.name || board.crews[0].name);
      }
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Routes could not be loaded.");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const crewNames = crews.length ? crews.map((item) => item.name) : DAMASIO_CREWS;
  const route = useMemo(() => {
    const visits = leads.filter((item) => item.canonicalVisitId && item.assignedCrew === crew && item.scheduledDate === date);
    const visitJobIds = new Set(visits.map((item) => item.canonicalJobId).filter(Boolean));
    const templates = leads.filter((item) => !item.canonicalVisitId && item.assignedCrew === crew && item.scheduledDate === date && !visitJobIds.has(item.canonicalJobId));
    return [...visits, ...templates].sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999) || a.address.localeCompare(b.address));
  }, [leads, crew, date]);
  const jobs = useMemo(() => leads.filter((item) => !item.canonicalVisitId), [leads]);
  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = jobs.filter((home) => !needle || `${home.name} ${home.address} ${home.assignedCrew || ""}`.toLowerCase().includes(needle));
    return source.sort((a, b) => (a.assignedCrew || "").localeCompare(b.assignedCrew || "") || a.address.localeCompare(b.address));
  }, [jobs, query]);
  const selectedHomes = jobs.filter((home) => selected.includes(home.id));
  const selectedRouteHomes = route.filter((home) => selected.includes(home.id));
  const done = route.filter((home) => home.status === "completed").length;
  const remaining = Math.max(0, route.length - done);

  function switchMode(next: Mode) {
    setMode(next);
    setSelected([]);
    setDraft([]);
    setMessage("");
    if (next === "move") setTargetCrew(crewNames.find((name) => name !== crew) || crew);
  }

  function toggle(id: string) {
    setDraft([]);
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function smartSelect() {
    const available = candidates.filter((home) => !home.assignedCrew);
    const pool = available.length ? available : candidates.filter((home) => home.assignedCrew === crew || !home.assignedCrew);
    const counts = pool.reduce<Record<string, number>>((result, home) => {
      const city = cityOf(home.address);
      result[city] = (result[city] || 0) + 1;
      return result;
    }, {});
    const region = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const source = region ? pool.filter((home) => cityOf(home.address) === region) : pool;
    setSelected(source.map((home) => home.id));
    setDraft([]);
    setMessage(`${source.length} ${region || "available"} houses grouped for a practical route.`);
  }

  async function buildPreview() {
    if (!selectedHomes.length) { setMessage("Select at least one house."); return; }
    setBusy(true);
    setMessage("Mapping houses and calculating the smartest order...");
    try {
      const mapped = await Promise.all(selectedHomes.map(async (home) => {
        if (Number.isFinite(home.latitude) && Number.isFinite(home.longitude)) return home;
        const response = await fetch(`/api/map/geocode?address=${encodeURIComponent(home.address)}`, { cache: "no-store" });
        return response.ok ? { ...home, ...await response.json() as { latitude: number; longitude: number } } : home;
      }));
      const located = mapped.filter((home) => Number.isFinite(home.latitude) && Number.isFinite(home.longitude));
      let ordered = [...mapped].sort((a, b) => a.address.localeCompare(b.address));
      if (located.length > 1) {
        let start: [number, number] = [Number(located[0].longitude), Number(located[0].latitude)];
        if (startAddress.trim()) {
          const response = await fetch(`/api/map/geocode?address=${encodeURIComponent(startAddress.trim())}`, { cache: "no-store" });
          if (response.ok) {
            const point = await response.json() as { latitude: number; longitude: number };
            start = [point.longitude, point.latitude];
          }
        }
        const response = await fetch("/api/map/optimize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start, coordinates: located.map((home) => [Number(home.longitude), Number(home.latitude)]) }),
        });
        if (response.ok) {
          const result = await response.json() as { order: number[] };
          ordered = [...result.order.map((index) => located[index]).filter(Boolean), ...mapped.filter((home) => !located.some((item) => item.id === home.id))];
        }
      }
      setDraft(ordered);
      setView("map");
      setMessage("Preview ready. Check the map and confirm.");
    } catch {
      setDraft([...selectedHomes].sort((a, b) => a.address.localeCompare(b.address)));
      setMessage("Safe address order created for review.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    const crewId = crews.find((item) => item.name === crew)?.id;
    if (!crewId || !draft.length) { setMessage("Choose an Employee and generate the preview first."); return; }
    if (!window.confirm(`Send ${draft.length} houses to ${crew} on ${date}?`)) return;
    setBusy(true);
    try {
      for (let index = 0; index < draft.length; index++) {
        await publishJobRoutePattern({ jobId: draft[index].canonicalJobId || draft[index].id, crewId, routeDate: date, routeOrder: index + 1 });
      }
      setMessage("Route published and synchronized with the Employee map.");
      setSelected([]);
      setDraft([]);
      setMode("view");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Route could not be published.");
    } finally {
      setBusy(false);
    }
  }

  async function moveHomes() {
    const targetId = crews.find((item) => item.name === targetCrew)?.id;
    if (!targetId || !selectedRouteHomes.length) { setMessage("Select houses and the destination Employee."); return; }
    if (!window.confirm(`Move ${selectedRouteHomes.length} houses to ${targetCrew} on ${targetDate}?`)) return;
    setBusy(true);
    try {
      for (let index = 0; index < selectedRouteHomes.length; index++) {
        const home = selectedRouteHomes[index];
        if (home.canonicalVisitId) await rescheduleVisit({ visitId: home.canonicalVisitId, crewId: targetId, routeDate: targetDate, routeOrder: index + 1 });
        else await publishJobRoutePattern({ jobId: home.canonicalJobId || home.id, crewId: targetId, routeDate: targetDate, routeOrder: index + 1 });
      }
      setMessage("Houses moved. Both Employee routes were updated.");
      setSelected([]);
      setMode("view");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Houses could not be moved.");
    } finally {
      setBusy(false);
    }
  }

  const activeList = mode === "build" ? candidates : route;
  const activeSelection = mode === "build" ? selected : selected;
  const mapRoute = draft.length ? draft : route;

  return (
    <AdminShell active="Routes">
      <section className="desktop-route-studio">
        <header className="desktop-route-hero">
          <div>
            <span>Dispatch & Routes</span>
            <h1>{mode === "build" ? "Build routes like the mobile app." : mode === "move" ? "Move houses without rebuilding." : `${route.length} stops for ${crew}.`}</h1>
            <p>{mode === "view" ? `${done} completed, ${remaining} remaining for ${date}.` : "Select, preview, confirm. The Employee route updates after publish."}</p>
          </div>
          <div className="desktop-route-actions">
            <button className="btn btn-outline" onClick={() => void refresh()} disabled={busy}>Refresh</button>
            <Link className="btn btn-primary" href={`/employee/route?crew=${encodeURIComponent(crew)}&date=${encodeURIComponent(date)}`}>Employee View</Link>
          </div>
        </header>

        <nav className="desktop-route-modes">
          <button className={mode === "view" ? "active" : ""} onClick={() => switchMode("view")}>View</button>
          <button className={mode === "build" ? "active" : ""} onClick={() => switchMode("build")}>Build</button>
          <button className={mode === "move" ? "active" : ""} onClick={() => switchMode("move")}>Move</button>
        </nav>

        <section className="desktop-route-controls">
          <label><span>Employee / Crew</span><select value={crew} onChange={(event) => { setCrew(event.target.value); setSelected([]); setDraft([]); }}>{crewNames.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label><span>Day</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelected([]); setDraft([]); }} /></label>
          {mode === "build" && <label className="wide"><span>Search customers</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, address, employee..." /></label>}
        </section>

        {message && <div className="desktop-route-message">{message}</div>}

        <section className="desktop-route-workspace">
          <article className="desktop-route-map-card">
            <div className="desktop-route-map-head">
              <div><strong>{draft.length ? "Preview Route" : "Route Map"}</strong><span>{mapRoute.length} stops</span></div>
              <div className="desktop-route-toggle"><button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>Map</button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button></div>
            </div>
            {view === "map" ? <EmployeeRouteMap route={mapRoute} desktop actionLabel="Show in list" onOpenVisit={() => setView("list")} /> : <DesktopRouteList homes={mapRoute} selected={[]} onToggle={() => {}} selectable={false} />}
          </article>

          <aside className="desktop-route-side">
            {mode === "view" && <>
              <div className="desktop-route-side-head"><strong>Today Route</strong><span>{route.length} stops</span></div>
              <DesktopRouteList homes={route} selected={[]} onToggle={() => {}} selectable={false} compact />
            </>}

            {mode === "build" && <>
              <div className="desktop-route-side-head"><strong>{selected.length} selected</strong><button onClick={smartSelect}>Smart Select</button></div>
              <DesktopRouteList homes={activeList} selected={activeSelection} onToggle={toggle} selectable compact />
              <div className="desktop-route-build-box">
                <label>Start address <small>Optional</small></label>
                <AddressAutocomplete value={startAddress} onChange={(value) => { setStartAddress(value); setDraft([]); }} placeholder="Office, depot or crew start" ariaLabel="Route start" />
                <button className="btn btn-primary" disabled={busy || !selected.length} onClick={() => void buildPreview()}>{busy ? "Optimizing..." : "Generate Smart Route"}</button>
                {draft.length > 0 && <button className="btn btn-outline" disabled={busy} onClick={() => void publish()}>Confirm & Send</button>}
              </div>
            </>}

            {mode === "move" && <>
              <div className="desktop-route-side-head"><strong>{selected.length} selected</strong><span>Move from {crew}</span></div>
              <DesktopRouteList homes={route} selected={selected} onToggle={toggle} selectable compact />
              <div className="desktop-route-build-box">
                <label>Move to Employee<select value={targetCrew} onChange={(event) => setTargetCrew(event.target.value)}>{crewNames.filter((name) => name !== crew).map((name) => <option key={name}>{name}</option>)}</select></label>
                <label>Move to day<input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
                <button className="btn btn-primary" disabled={busy || !selected.length} onClick={() => void moveHomes()}>{busy ? "Moving..." : `Move ${selected.length} house${selected.length === 1 ? "" : "s"}`}</button>
              </div>
            </>}
          </aside>
        </section>
      </section>
    </AdminShell>
  );
}

function DesktopRouteList({ homes, selected, onToggle, selectable, compact = false }: { homes: Lead[]; selected: string[]; onToggle: (id: string) => void; selectable: boolean; compact?: boolean }) {
  return (
    <div className={compact ? "desktop-route-list compact" : "desktop-route-list"}>
      {homes.map((home, index) => (
        <button key={home.id} type="button" className={selected.includes(home.id) ? "selected" : ""} onClick={() => selectable && onToggle(home.id)}>
          <b>{selectable ? (selected.includes(home.id) ? "OK" : "") : index + 1}</b>
          <span><strong>{home.name}</strong><small>{home.address}</small><em>{home.service} - {home.assignedCrew || "Unassigned"}</em></span>
          <i className={home.status === "completed" ? "done" : ""}>{home.status === "completed" ? "Done" : home.assignedCrew || "Open"}</i>
        </button>
      ))}
      {!homes.length && <div className="desktop-route-empty"><strong>No houses found</strong><p>Change the Employee, day or search.</p></div>}
    </div>
  );
}
